import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataSource } from '../js/data-source.js';

const INDEX = { built: '2026-11-02', genres: [{ slug: 'thrash-metal', name: 'thrash metal', counts: {} }, { slug: 'grunge', name: 'grunge', counts: {} }] };
const FILES = {
  'data/index.json': INDEX,
  'data/artists/thrash-metal.json': [['Metallica', 'metallica'], ['Slayer', 'slayer']],
  'data/albums/thrash-metal.json': [['Metallica', [['Kill ’Em All', 1983], ['Master of Puppets', 1986]]]],
  'data/songs/metallica.json': ['Hit the Lights', 'Battery', 'Orion'],
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

test('flattens nested albums', async () => {
  const data = createDataSource({ fetchImpl: fakeFetch() });
  const albums = await data.albums('thrash metal');
  assert.deepEqual(albums.map(({ title, artist, year }) => ({ title, artist, year })), [
    { title: 'Kill ’Em All', artist: 'Metallica', year: 1983 },
    { title: 'Master of Puppets', artist: 'Metallica', year: 1986 },
  ]);
});

test('lists artists with their songs key, and loads only the drawn artist songs file', async () => {
  const fetchImpl = fakeFetch();
  const data = createDataSource({ fetchImpl });
  const artists = await data.artists('thrash metal');
  assert.deepEqual(artists, [{ name: 'Metallica', key: 'metallica' }, { name: 'Slayer', key: 'slayer' }]);
  const songs = await data.songsOf(artists[0]);
  assert.deepEqual(songs.map(({ title, artist }) => ({ title, artist })), [
    { title: 'Hit the Lights', artist: 'Metallica' },
    { title: 'Battery', artist: 'Metallica' },
    { title: 'Orion', artist: 'Metallica' },
  ]);
  assert.equal(new Set(songs.map((x) => x.id)).size, 3);
  assert.ok(fetchImpl.calls.includes('data/songs/metallica.json'));
  assert.ok(!fetchImpl.calls.some((u) => u.includes('slayer')), 'only the drawn artist is downloaded');
});

test('ids differ for non-Latin names (no collapse to empty)', async () => {
  const files = { ...FILES, 'data/artists/thrash-metal.json': [['Ария', 'artist-1'], ['Кино', 'artist-2'], ['X Japan', 'x-japan']] };
  const data = createDataSource({ fetchImpl: fakeFetch(files) });
  const bands = await data.bands('thrash metal');
  assert.equal(new Set(bands.map((b) => b.id)).size, 3);
});

test('a failed file is retried on the next call', async () => {
  const files = { ...FILES, 'data/songs/metallica.json': new Error('offline') };
  const fetchImpl = fakeFetch(files);
  const data = createDataSource({ fetchImpl });
  const metallica = { name: 'Metallica', key: 'metallica' };
  await assert.rejects(data.songsOf(metallica), /offline/);
  files['data/songs/metallica.json'] = FILES['data/songs/metallica.json'];
  assert.equal((await data.songsOf(metallica)).length, 3);
});

test('a stalled file times out, and the next call tries again', { timeout: 3000 }, async () => {
  let songDownloads = 0;
  const fetchImpl = (url, init = {}) => {
    if (url.endsWith('index.json')) return Promise.resolve({ ok: true, status: 200, json: async () => INDEX });
    songDownloads += 1;
    if (songDownloads === 1) return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('timed out'))));
    return Promise.resolve({ ok: true, status: 200, json: async () => FILES['data/songs/metallica.json'] });
  };
  const data = createDataSource({ fetchImpl, timeoutMs: 50 });
  const metallica = { name: 'Metallica', key: 'metallica' };
  await assert.rejects(data.songsOf(metallica));
  assert.equal((await data.songsOf(metallica)).length, 3);
});

test('a missing file rejects with the status', async () => {
  const data = createDataSource({ fetchImpl: fakeFetch() });
  await assert.rejects(data.albums('grunge'), /404/);
});
