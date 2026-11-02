import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFetcher } from '../tools/fetcher.mjs';

const UA = 'this-or-that/1.0 ( https://github.com/MORIN1709/this-or-that )';
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function clock() {
  let t = 0;
  const sleeps = [];
  return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps };
}

function fakeFetch(responses, c) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, at: c ? c.now() : 0 });
    return responses.length > 1 ? responses.shift() : responses[0];
  };
  fn.calls = calls;
  return fn;
}

const tempCache = () => mkdtemp(join(tmpdir(), 'fetcher-'));

test('sends user agent', async () => {
  const c = clock();
  const fetchImpl = fakeFetch([json(200, {})], c);
  const f = createFetcher({ cacheDir: await tempCache(), userAgent: UA, fetchImpl, sleep: c.sleep, now: c.now });
  await f.getJson('https://musicbrainz.org/ws/2/artist?x=1');
  assert.equal(fetchImpl.calls[0].init.headers['User-Agent'], UA);
});

test('spaces requests by 1100ms', async () => {
  const c = clock();
  const fetchImpl = fakeFetch([json(200, {})], c);
  const f = createFetcher({ cacheDir: await tempCache(), userAgent: UA, fetchImpl, sleep: c.sleep, now: c.now });
  await Promise.all([f.getJson('https://a.test/1'), f.getJson('https://a.test/2')]);
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls[1].at - fetchImpl.calls[0].at >= 1100);
});

test('cache hit makes no request, also for a new fetcher on the same cache', async () => {
  const c = clock();
  const cacheDir = await tempCache();
  const fetchImpl = fakeFetch([json(200, { ok: 1 })], c);
  const f = createFetcher({ cacheDir, userAgent: UA, fetchImpl, sleep: c.sleep, now: c.now });
  assert.deepEqual(await f.getJson('https://a.test/x'), { ok: 1 });
  assert.deepEqual(await f.getJson('https://a.test/x'), { ok: 1 });
  const g = createFetcher({ cacheDir, userAgent: UA, fetchImpl, sleep: c.sleep, now: c.now });
  assert.deepEqual(await g.getJson('https://a.test/x'), { ok: 1 });
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(f.stats, { network: 1, cached: 1 });
});

test('postJson caches by url and body', async () => {
  const c = clock();
  const fetchImpl = fakeFetch([json(200, [])], c);
  const f = createFetcher({ cacheDir: await tempCache(), userAgent: UA, fetchImpl, sleep: c.sleep, now: c.now });
  await f.postJson('https://lb.test/p', { ids: ['a'] });
  await f.postJson('https://lb.test/p', { ids: ['a'] });
  await f.postJson('https://lb.test/p', { ids: ['b'] });
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[0].init.method, 'POST');
  assert.equal(fetchImpl.calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { ids: ['a'] });
});

test('retries 503', async () => {
  const c = clock();
  const fetchImpl = fakeFetch([json(503, {}), json(200, { ok: 2 })], c);
  const f = createFetcher({ cacheDir: await tempCache(), userAgent: UA, fetchImpl, sleep: c.sleep, now: c.now });
  assert.deepEqual(await f.getJson('https://a.test/r'), { ok: 2 });
  assert.ok(c.sleeps.includes(2000), `sleeps: ${c.sleeps}`);
});

test('retries a dropped connection instead of stopping the build', async () => {
  const c = clock();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('terminated (ECONNRESET)');
    return json(200, { ok: 4 });
  };
  const f = createFetcher({ cacheDir: await tempCache(), userAgent: UA, fetchImpl, sleep: c.sleep, now: c.now });
  assert.deepEqual(await f.getJson('https://a.test/reset'), { ok: 4 });
  assert.equal(calls, 2);
  assert.ok(c.sleeps.includes(2000), `sleeps: ${c.sleeps}`);
});

test('a corrupt cache file is fetched again instead of stopping the build', async () => {
  const c = clock();
  const cacheDir = await tempCache();
  const url = 'https://a.test/corrupt';
  const file = join(cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`);
  await writeFile(file, '{"releases": [1, 2');
  const fetchImpl = fakeFetch([json(200, { ok: 3 })], c);
  const f = createFetcher({ cacheDir, userAgent: UA, fetchImpl, sleep: c.sleep, now: c.now });
  const original = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    assert.deepEqual(await f.getJson(url), { ok: 3 });
  } finally {
    console.warn = original;
  }
  assert.ok(warnings.some((w) => w.includes(file)), warnings.join('\n'));
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ok: 3 });
  assert.deepEqual((await readdir(cacheDir)).filter((n) => !n.endsWith('.json')), [], 'no temp files left');
});

test('does not cache errors', async () => {
  const c = clock();
  const cacheDir = await tempCache();
  const fetchImpl = fakeFetch([json(404, {})], c);
  const f = createFetcher({ cacheDir, userAgent: UA, fetchImpl, sleep: c.sleep, now: c.now });
  await assert.rejects(f.getJson('https://a.test/missing'), /404/);
  assert.deepEqual(await readdir(cacheDir), []);
});
