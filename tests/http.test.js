import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMbClient, createLbClient, ApiError } from '../js/http.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Fake clock: sleep(ms) advances `now` instantly and records the wait.
function fakeClock() {
  let t = 0;
  const sleeps = [];
  return {
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    sleeps,
  };
}

function fakeFetch(responses, clock) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init, at: clock ? clock.now() : 0 });
    const r = responses.length > 1 ? responses.shift() : responses[0];
    return typeof r === 'function' ? r() : r;
  };
  fn.calls = calls;
  return fn;
}

test('mb.get builds URL with fmt=json and params', async () => {
  const clock = fakeClock();
  const fetchImpl = fakeFetch([jsonResponse(200, { artists: [] })], clock);
  const mb = createMbClient({ fetchImpl, sleep: clock.sleep, now: clock.now });
  await mb.get('/artist', { query: 'tag:"grunge"', limit: 100, offset: 0 });
  const { url, init } = fetchImpl.calls[0];
  assert.ok(url.startsWith('https://musicbrainz.org/ws/2/artist?'), url);
  const p = new URL(url).searchParams;
  assert.equal(p.get('fmt'), 'json');
  assert.equal(p.get('query'), 'tag:"grunge"');
  assert.equal(p.get('limit'), '100');
  assert.equal(p.get('offset'), '0');
  assert.equal(init.headers.Accept, 'application/json');
});

test('mb.get spaces requests by 1050ms', async () => {
  const clock = fakeClock();
  const fetchImpl = fakeFetch([jsonResponse(200, {})], clock);
  const mb = createMbClient({ fetchImpl, sleep: clock.sleep, now: clock.now });
  await Promise.all([mb.get('/artist', {}), mb.get('/artist', {})]);
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls[1].at - fetchImpl.calls[0].at >= 1050,
    `gap was ${fetchImpl.calls[1].at - fetchImpl.calls[0].at}`);
});

test('mb.get retries 503 then succeeds', async () => {
  const clock = fakeClock();
  const fetchImpl = fakeFetch([jsonResponse(503, {}), jsonResponse(200, { ok: 1 })], clock);
  const mb = createMbClient({ fetchImpl, sleep: clock.sleep, now: clock.now });
  const result = await mb.get('/artist', {});
  assert.deepEqual(result, { ok: 1 });
  assert.ok(clock.sleeps.includes(2000), `sleeps: ${clock.sleeps}`);
});

test('mb.get throws ApiError after 4 x 503', async () => {
  const clock = fakeClock();
  const fetchImpl = fakeFetch([jsonResponse(503, {})], clock);
  const mb = createMbClient({ fetchImpl, sleep: clock.sleep, now: clock.now });
  await assert.rejects(mb.get('/artist', {}), (err) => err instanceof ApiError && err.status === 503);
  assert.equal(fetchImpl.calls.length, 4);
});

test('mb.get does not retry 404', async () => {
  const clock = fakeClock();
  const fetchImpl = fakeFetch([jsonResponse(404, {})], clock);
  const mb = createMbClient({ fetchImpl, sleep: clock.sleep, now: clock.now });
  await assert.rejects(mb.get('/artist', {}), (err) => err instanceof ApiError && err.status === 404);
  assert.equal(fetchImpl.calls.length, 1);
});

test('lb.popularity posts batch', async () => {
  const fetchImpl = fakeFetch([jsonResponse(200, [
    { release_group_mbid: 'a', total_listen_count: 70, total_user_count: 7 },
    { release_group_mbid: 'b', total_listen_count: null, total_user_count: null },
  ])]);
  const lb = createLbClient({ fetchImpl });
  const scores = await lb.popularity('release-group', ['a', 'b']);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.listenbrainz.org/1/popularity/release-group');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), { release_group_mbids: ['a', 'b'] });
  assert.equal(scores.get('a'), 7);
  assert.equal(scores.get('b'), 0);
});

// A response whose body never finishes downloading, but stops when the request is aborted (like real fetch).
function stalledBody(init) {
  return {
    ok: true,
    status: 200,
    json: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
  };
}

test('mb.get times out a stalled body and the queue keeps going', { timeout: 3000 }, async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    return calls === 1 ? stalledBody(init) : jsonResponse(200, { ok: 2 });
  };
  const mb = createMbClient({ fetchImpl, sleep: async () => {}, now: () => 0, timeoutMs: 50 });
  await assert.rejects(mb.get('/artist', {}));
  assert.deepEqual(await mb.get('/artist', {}), { ok: 2 });
});

test('lb.popularity times out a stalled body', { timeout: 3000 }, async () => {
  const lb = createLbClient({ fetchImpl: async (url, init) => stalledBody(init), timeoutMs: 50 });
  await assert.rejects(lb.popularity('artist', ['a']));
});

test('lb.popularity warns when the response is not an array', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    const lb = createLbClient({ fetchImpl: fakeFetch([jsonResponse(200, { payload: [] })]) });
    const scores = await lb.popularity('artist', ['a']);
    assert.equal(scores.size, 0);
  } finally {
    console.warn = original;
  }
  assert.ok(warnings.some((w) => w.includes('ListenBrainz') && w.includes('payload')), warnings.join('\n'));
});

test('lb.popularity with empty list makes no request', async () => {
  const fetchImpl = fakeFetch([jsonResponse(200, [])]);
  const lb = createLbClient({ fetchImpl });
  const scores = await lb.popularity('artist', []);
  assert.equal(scores.size, 0);
  assert.equal(fetchImpl.calls.length, 0);
});
