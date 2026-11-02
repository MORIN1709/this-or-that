import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAll, writeData } from '../tools/build-data.mjs';

// ---- fake API in the shapes the real MusicBrainz / ListenBrainz return ----
const artist = (id, name, genre) => ({ id, name, type: 'Group', tags: [{ name: genre, count: 10 }] });
const rel = (rgId, title, year, tracks) => ({
  id: `${rgId}-r`, date: `${year}-01-01`, status: 'Official',
  'release-group': { id: rgId, title, 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': `${year}-01-01` },
  media: [{ format: 'CD', tracks: tracks.map((t) => ({ title: t, recording: { title: t } })) }],
});

function fakeFetcher({ searches, releases }) {
  const calls = [];
  return {
    calls,
    stats: { network: 0, cached: 0 },
    async getJson(url) {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname === '/ws/2/artist') {
        const genre = u.searchParams.get('query').match(/tag:"([^"]+)"/)[1];
        return { count: (searches[genre] || []).length, artists: searches[genre] || [] };
      }
      if (u.pathname === '/ws/2/release') {
        const all = releases[u.searchParams.get('artist')] || [];
        const offset = Number(u.searchParams.get('offset'));
        const pageSize = 2; // the real API returns fewer than `limit` when recordings are included
        return { 'release-count': all.length, 'release-offset': offset, releases: all.slice(offset, offset + pageSize) };
      }
      throw new Error(`unexpected ${url}`);
    },
    async postJson(url, body) {
      calls.push(url);
      return body.artist_mbids.map((id, i) => ({ artist_mbid: id, total_user_count: 1000 - i }));
    },
  };
}

const thrashArtists = ['Metallica', 'Slayer', 'Megadeth', 'Anthrax', 'Exodus', 'Testament']
  .map((name, i) => artist(`a${i}`, name, 'thrash metal'));
const someReleases = Object.fromEntries(thrashArtists.map((a, i) => [a.id, [rel(`${a.id}-rg`, `${a.name} Album`, 1985 + i, ['One', 'Two'])]]));

test('builds nested files for one genre', async () => {
  const fetcher = fakeFetcher({ searches: { 'thrash metal': thrashArtists }, releases: someReleases });
  const { index, files } = await buildAll({ fetcher, genres: ['thrash metal'], perGenre: 2, minArtists: 2 });
  assert.deepEqual([...files.keys()].sort(), ['albums/thrash-metal.json', 'artists/thrash-metal.json', 'songs/metallica.json', 'songs/slayer.json']);
  assert.deepEqual(files.get('artists/thrash-metal.json'), [['Metallica', 'metallica'], ['Slayer', 'slayer']]);
  assert.deepEqual(files.get('albums/thrash-metal.json')[0], ['Metallica', [['Metallica Album', 1985]]]);
  assert.deepEqual(files.get('songs/metallica.json'), ['One', 'Two']);
  assert.deepEqual(index.genres, [{ slug: 'thrash-metal', name: 'thrash metal', counts: { artists: 2, albums: 2, songs: 4 } }]);
  const search = new URL(fetcher.calls[0]).searchParams;
  assert.equal(search.get('query'), 'tag:"thrash metal" AND (type:group OR type:person) AND NOT country:IL');
  assert.equal(search.get('limit'), '100');
});

test('pages by returned count', async () => {
  const many = [1, 2, 3, 4, 5].map((n) => rel(`rg${n}`, `Album ${n}`, 1980 + n, ['Song']));
  const fetcher = fakeFetcher({ searches: { 'thrash metal': thrashArtists.slice(0, 1) }, releases: { a0: many } });
  const { files } = await buildAll({ fetcher, genres: ['thrash metal'], perGenre: 1, minArtists: 1 });
  const offsets = fetcher.calls.filter((u) => u.includes('/ws/2/release?')).map((u) => new URL(u).searchParams.get('offset'));
  assert.deepEqual(offsets, ['0', '2', '4']);
  assert.equal(files.get('albums/thrash-metal.json')[0][1].length, 5);
  const params = new URL(fetcher.calls.find((u) => u.includes('/ws/2/release?'))).searchParams;
  assert.equal(params.get('status'), 'official');
  assert.equal(params.get('type'), 'album');
  assert.equal(params.get('inc'), 'recordings+release-groups');
});

test('fetches each artist once across genres', async () => {
  const shared = artist('a0', 'Metallica', 'heavy metal');
  shared.tags.push({ name: 'thrash metal', count: 9 });
  const fetcher = fakeFetcher({
    searches: { 'thrash metal': [shared], 'heavy metal': [shared] },
    releases: { a0: [rel('rg', 'Master of Puppets', 1986, ['Battery'])] },
  });
  const { files } = await buildAll({ fetcher, genres: ['thrash metal', 'heavy metal'], perGenre: 1, minArtists: 1 });
  assert.equal(fetcher.calls.filter((u) => u.includes('artist=a0')).length, 1);
  assert.deepEqual(files.get('artists/heavy-metal.json'), [['Metallica', 'metallica']]);
  assert.equal([...files.keys()].filter((k) => k.startsWith('songs/')).length, 1, 'one songs file shared by both genres');
});

test('drops a genre with fewer than 5 artists', async () => {
  const fetcher = fakeFetcher({
    searches: { 'thrash metal': thrashArtists, 'stoner rock': thrashArtists.slice(0, 2).map((a) => artist(a.id, a.name, 'stoner rock')) },
    releases: someReleases,
  });
  const { index, files } = await buildAll({ fetcher, genres: ['thrash metal', 'stoner rock'] });
  assert.deepEqual(index.genres.map((g) => g.slug), ['thrash-metal']);
  assert.ok(![...files.keys()].some((k) => k.includes('stoner')));
});

test('writeData writes compact files and merges index with genres already on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'data-'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.json'), JSON.stringify({ genres: [{ slug: 'grunge', name: 'grunge', counts: {} }, { slug: 'thrash-metal', name: 'thrash metal', counts: { artists: 1 } }] }));
  const files = new Map([['artists/thrash-metal.json', ['Metallica']]]);
  const index = { built: '2026-11-02', genres: [{ slug: 'thrash-metal', name: 'thrash metal', counts: { artists: 1, albums: 0, songs: 0 } }] };
  await writeData(dir, { index, files });
  assert.equal(await readFile(join(dir, 'artists/thrash-metal.json'), 'utf8'), '["Metallica"]');
  const merged = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  assert.deepEqual(merged.genres.map((g) => g.slug), ['grunge', 'thrash-metal']);
  assert.deepEqual(merged.genres[1].counts, { artists: 1, albums: 0, songs: 0 });
});
