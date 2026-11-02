import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMusicSources } from '../js/music-sources.js';
import { TOP_N } from '../js/config.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

// Fake MusicBrainz: answers by path, records every call.
function fakeMb(handler) {
  const calls = [];
  return { calls, get: async (path, params = {}) => { calls.push({ path, params }); return handler(path, params, calls.length); } };
}

// Fake ListenBrainz: score = position from the end, so the first id ranks highest.
function fakeLb(scoreFor = (ids, i) => ids.length - i) {
  const calls = [];
  return {
    calls,
    popularity: async (entity, ids) => {
      calls.push({ entity, ids });
      return new Map(ids.map((id, i) => [id, scoreFor(ids, i, id)]));
    },
  };
}

test('bands: two tag-search pages, one batch popularity call, sorted {id,title}', async () => {
  const page = fixture('mb-artists.json');
  const mb = fakeMb(() => ({ ...page, count: 150 }));
  const lb = fakeLb((ids, i) => i + 1); // last id is most popular
  const bands = await createMusicSources({ mb, lb }).bands('thrash metal');

  assert.deepEqual(mb.calls.map((c) => c.path), ['/artist', '/artist']);
  const query = 'tag:"thrash metal" AND (type:group OR type:person) AND NOT country:IL';
  assert.deepEqual(mb.calls.map((c) => c.params), [
    { query, limit: 100, offset: 0 },
    { query, limit: 100, offset: 100 },
  ]);
  assert.equal(lb.calls.length, 1);
  assert.equal(lb.calls[0].entity, 'artist');
  assert.equal(lb.calls[0].ids.length, page.artists.length, 'ids deduplicated across pages');
  const last = page.artists.at(-1);
  assert.deepEqual(bands[0], { id: last.id, title: last.name });
  assert.ok(bands.length <= TOP_N);
});

test('bands: skips second page when first page holds everything', async () => {
  const mb = fakeMb(() => fixture('mb-artists.json')); // count 8
  await createMusicSources({ mb, lb: fakeLb() }).bands('grunge');
  assert.equal(mb.calls.length, 1);
});

test('bands: memoizes per tag', async () => {
  const mb = fakeMb(() => ({ ...fixture('mb-artists.json'), count: 150 }));
  const sources = createMusicSources({ mb, lb: fakeLb() });
  await sources.bands('grunge');
  await sources.bands('grunge');
  assert.equal(mb.calls.length, 2);
});

test('bands: a failure is not cached', async () => {
  let fail = true;
  const mb = fakeMb(() => { if (fail) throw new Error('boom'); return fixture('mb-artists.json'); });
  const sources = createMusicSources({ mb, lb: fakeLb() });
  await assert.rejects(sources.bands('grunge'));
  fail = false;
  const bands = await sources.bands('grunge');
  assert.ok(bands.length > 0);
});

test('albums: tag query, studio-only, deduped, artist credit, year, ranked by release-group popularity', async () => {
  const mb = fakeMb(() => fixture('mb-release-groups.json'));
  const lb = fakeLb();
  const albums = await createMusicSources({ mb, lb }).albums('thrash metal');

  assert.deepEqual(mb.calls[0], {
    path: '/release-group',
    params: { query: 'tag:"thrash metal" AND primarytype:album AND status:official', limit: 100, offset: 0 },
  });
  assert.equal(lb.calls[0].entity, 'release-group');
  const titles = albums.map((a) => a.title);
  for (const bad of ['Live Shit: Binge & Purge', 'Greatest Hits', 'Master of Puppets (Remastered)', 'No Date Album']) {
    assert.ok(!titles.includes(bad), `${bad} should be filtered`);
  }
  const mop = albums.find((a) => a.title === 'Master of Puppets');
  assert.deepEqual(Object.keys(mop).sort(), ['artist', 'id', 'title', 'year']);
  assert.equal(mop.artist, 'Metallica');
  assert.equal(mop.year, '1986');
  assert.equal(albums.find((a) => a.title === '...And Justice for All').artist, 'Metallica & Friends');
});

test('songsFromAlbum: earliest official release, audio only, no demo/live, all remaining tracks', async () => {
  const mb = fakeMb((path) => (path.startsWith('/release-group/') ? fixture('mb-release-group-releases.json') : fixture('mb-release.json')));
  const lb = fakeLb();
  const album = { id: 'RG', title: 'Master of Puppets', artist: 'Metallica', year: '1986' };
  const songs = await createMusicSources({ mb, lb }).songsFromAlbum(album);

  assert.deepEqual(mb.calls, [
    { path: '/release-group/RG', params: { inc: 'releases' } },
    { path: '/release/rel-early', params: { inc: 'recordings' } },
  ]);
  assert.equal(lb.calls.length, 0, 'songs do not use ListenBrainz');
  const titles = songs.map((s) => s.title);
  assert.equal(songs.length, 8);
  assert.ok(!titles.includes('Orion (live)'));
  assert.ok(!titles.includes('Battery (demo)'));
  assert.ok(!titles.includes('Battery (5.1 mix)'));
  const battery = songs.find((s) => s.title === 'Battery');
  assert.deepEqual(Object.keys(battery).sort(), ['artist', 'id', 'title', 'year']);
  assert.equal(battery.artist, 'Metallica');
  assert.equal(battery.year, '1986');
});

test('items with Hebrew script in the name are dropped (no Israeli music)', async () => {
  const groups = fixture('mb-release-groups.json');
  groups['release-groups'][2].title = 'שיר לשלום';
  groups['release-groups'][3]['artist-credit'] = [{ name: 'כוורת', joinphrase: '' }];
  const artists = fixture('mb-artists.json');
  artists.artists[0].name = 'משינה';
  const release = fixture('mb-release.json');
  release.media[0].tracks[0].title = 'יושב על הגדר';
  const mb = fakeMb((path) => ({
    '/artist': artists, '/release-group': groups,
  }[path] || (path.startsWith('/release-group/') ? fixture('mb-release-group-releases.json') : release)));
  const sources = createMusicSources({ mb, lb: fakeLb() });
  const hebrew = /[֐-׿]/;
  assert.ok(!(await sources.bands('x')).some((b) => hebrew.test(b.title)));
  assert.ok(!(await sources.albums('x')).some((a) => hebrew.test(a.title + a.artist)));
  assert.ok(!(await sources.songsFromAlbum({ id: 'RG', title: 't', artist: 'a' })).some((s) => hebrew.test(s.title)));
});

test('warns with the response keys when the expected array is missing', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    const mb = fakeMb(() => ({ created: 'x', somethingElse: [] }));
    await createMusicSources({ mb, lb: fakeLb() }).bands('grunge');
  } finally {
    console.warn = original;
  }
  assert.ok(warnings.some((w) => w.includes('artists') && w.includes('somethingElse')), warnings.join('\n'));
});

test('warns when ListenBrainz scores none of the candidates', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    const mb = fakeMb(() => fixture('mb-artists.json'));
    const lb = { popularity: async () => new Map() };
    assert.deepEqual(await createMusicSources({ mb, lb }).bands('grunge'), []);
  } finally {
    console.warn = original;
  }
  assert.ok(warnings.some((w) => w.includes('ListenBrainz') && w.includes('grunge')), warnings.join('\n'));
});

test('missing arrays in responses give [] instead of throwing', async () => {
  const mb = fakeMb(() => ({}));
  const sources = createMusicSources({ mb, lb: fakeLb() });
  assert.deepEqual(await sources.bands('grunge'), []);
  assert.deepEqual(await sources.albums('grunge'), []);
  assert.deepEqual(await sources.songsFromAlbum({ id: 'x', title: 't', artist: 'a' }), []);
});
