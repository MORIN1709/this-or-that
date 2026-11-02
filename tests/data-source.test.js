import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataSource } from '../js/data-source.js';

const INDEX = { built: '2026-11-02', genres: [{ slug: 'thrash-metal', name: 'thrash metal', counts: {} }, { slug: 'grunge', name: 'grunge', counts: {} }] };
const FILES = {
  'data/index.json': INDEX,
  'data/artists/thrash-metal.json': ['Metallica', 'Slayer'],
  'data/albums/thrash-metal.json': [['Metallica', [['Kill ’Em All', 1983], ['Master of Puppets', 1986]]]],
  'data/songs/thrash-metal.json': [['Metallica', [['Kill ’Em All', 1983, ['Hit the Lights']], ['Master of Puppets', 1986, ['Battery', 'Orion']]]]],
};

function fakeFetch(files = FILES) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (!(url in files)) return { ok: false, status: 404, json: async () => ({}) };
    const body = files[url];
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('lists genre names from the index', async () => {
  const data = createDataSource({ fetchImpl: fakeFetch() });
  assert.deepEqual(await data.genres(), ['thrash metal', 'grunge']);
});

test('loads index once and maps name to slug', async () => {
  const fetchImpl = fakeFetch();
  const data = createDataSource({ fetchImpl });
  const bands = await data.bands('thrash metal');
  await data.bands('thrash metal');
  await data.albums('thrash metal');
  assert.deepEqual(bands.map((b) => b.title), ['Metallica', 'Slayer']);
  assert.equal(fetchImpl.calls.filter((u) => u === 'data/index.json').length, 1);
  assert.equal(fetchImpl.calls.filter((u) => u === 'data/artists/thrash-metal.json').length, 1);
});

test('flattens nested albums and songs', async () => {
  const data = createDataSource({ fetchImpl: fakeFetch() });
  const albums = await data.albums('thrash metal');
  const songs = await data.songs('thrash metal');
  assert.deepEqual(albums.map(({ title, artist, year }) => ({ title, artist, year })), [
    { title: 'Kill ’Em All', artist: 'Metallica', year: 1983 },
    { title: 'Master of Puppets', artist: 'Metallica', year: 1986 },
  ]);
  assert.deepEqual(songs.map(({ title, artist, year }) => ({ title, artist, year })), [
    { title: 'Hit the Lights', artist: 'Metallica', year: 1983 },
    { title: 'Battery', artist: 'Metallica', year: 1986 },
    { title: 'Orion', artist: 'Metallica', year: 1986 },
  ]);
  assert.equal(new Set(songs.map((s) => s.id)).size, 3);
});

test('ids differ for non-Latin names (no collapse to empty)', async () => {
  const files = { ...FILES, 'data/artists/thrash-metal.json': ['Ария', 'Кино', 'X Japan'] };
  const data = createDataSource({ fetchImpl: fakeFetch(files) });
  const bands = await data.bands('thrash metal');
  assert.equal(new Set(bands.map((b) => b.id)).size, 3);
});

test('a failed file is retried on the next call', async () => {
  const files = { ...FILES, 'data/songs/thrash-metal.json': new Error('offline') };
  const fetchImpl = fakeFetch(files);
  const data = createDataSource({ fetchImpl });
  await assert.rejects(data.songs('thrash metal'), /offline/);
  files['data/songs/thrash-metal.json'] = FILES['data/songs/thrash-metal.json'];
  assert.equal((await data.songs('thrash metal')).length, 3);
});

test('a stalled file times out, and the next call tries again', { timeout: 3000 }, async () => {
  let calls = 0;
  const fetchImpl = (url, init = {}) => {
    calls += 1;
    if (url.endsWith('index.json')) return Promise.resolve({ ok: true, status: 200, json: async () => INDEX });
    if (calls <= 2) return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('timed out'))));
    return Promise.resolve({ ok: true, status: 200, json: async () => FILES['data/songs/thrash-metal.json'] });
  };
  const data = createDataSource({ fetchImpl, timeoutMs: 50 });
  await assert.rejects(data.songs('thrash metal'));
  assert.equal((await data.songs('thrash metal')).length, 3);
});

test('a missing file rejects with the status', async () => {
  const data = createDataSource({ fetchImpl: fakeFetch() });
  await assert.rejects(data.songs('grunge'), /404/);
});
