import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENRES, slugify, isMainTag, pickArtists, studioAlbums, genreFiles, artistKey, songList } from '../tools/build-lib.mjs';

test('GENRES keeps the 18 rock and metal tags', () => {
  assert.equal(GENRES.length, 18);
  assert.ok(GENRES.includes('thrash metal') && GENRES.includes('new wave of british heavy metal'));
});

test('slugify turns a tag into a file name', () => {
  assert.equal(slugify('thrash metal'), 'thrash-metal');
  assert.equal(slugify('new wave of british heavy metal'), 'new-wave-of-british-heavy-metal');
});

const tags = (...names) => names.map((name, i) => ({ name, count: 100 - i }));

test('isMainTag: genre among the 5 most-voted tags, case-insensitive', () => {
  assert.equal(isMainTag(tags('heavy metal', 'Thrash Metal', 'speed metal'), 'thrash metal'), true);
  assert.equal(isMainTag(tags('a', 'b', 'c', 'd', 'e', 'f', 'thrash metal'), 'thrash metal'), false);
  assert.equal(isMainTag(undefined, 'thrash metal'), false);
});

test('isMainTag ranks by count, not by list order', () => {
  const t = [{ name: 'thrash metal', count: 1 }, ...tags('a', 'b', 'c', 'd', 'e')];
  assert.equal(isMainTag(t, 'thrash metal'), false);
});

test('pickArtists filters Hebrew, off-genre and unscored artists, sorts by score, caps at n', () => {
  const thrash = tags('thrash metal');
  const candidates = [
    { id: '1', name: 'Metallica', tags: thrash },
    { id: '2', name: 'Slayer', tags: thrash },
    { id: '3', name: 'משינה', tags: thrash },
    { id: '4', name: 'Poison', tags: tags('glam metal', 'hard rock', 'heavy metal', 'rock', 'pop metal', '80s', 'thrash metal') },
    { id: '5', name: 'Nobody', tags: thrash },
    { id: '6', name: 'Megadeth', tags: thrash },
  ];
  const scores = new Map([['1', 300], ['2', 200], ['3', 999], ['4', 999], ['5', 0], ['6', 250]]);
  assert.deepEqual(pickArtists(candidates, scores, 'thrash metal', 2), [
    { id: '1', name: 'Metallica' },
    { id: '6', name: 'Megadeth' },
  ]);
  assert.deepEqual(pickArtists(candidates, scores, 'thrash metal').map((a) => a.name), ['Metallica', 'Megadeth', 'Slayer']);
});

test('pickArtists prefers genre-in-top-3 artists, then fills from top 5', () => {
  const withRank = (rank) => [...Array(rank - 1)].map((_, i) => ({ name: `x${i}`, count: 100 - i })).concat({ name: 'thrash metal', count: 100 - rank });
  const candidates = [
    { id: 'A', name: 'Accept', tags: withRank(4) },
    { id: 'B', name: 'Tankard', tags: withRank(1) },
    { id: 'C', name: 'Evile', tags: withRank(2) },
    { id: 'D', name: 'Poison', tags: withRank(6) },
  ];
  const scores = new Map([['A', 900], ['B', 100], ['C', 50], ['D', 999]]);
  assert.deepEqual(pickArtists(candidates, scores, 'thrash metal', 3).map((a) => a.id), ['B', 'C', 'A']);
  assert.deepEqual(pickArtists(candidates, scores, 'thrash metal', 2).map((a) => a.id), ['B', 'C']);
});

// Builds a release in the shape of /ws/2/release?artist=…&inc=recordings+release-groups
function release({ rg, rgTitle, first, secondary = [], date, tracks, format = 'CD', extraMedia = [] }) {
  return {
    id: `${rg}-${date}`,
    date,
    status: 'Official',
    'release-group': {
      id: rg, title: rgTitle, 'primary-type': 'Album', 'secondary-types': secondary, 'first-release-date': first,
    },
    media: [{ format, tracks: tracks.map((title) => ({ title, recording: { title } })) }, ...extraMedia],
  };
}

test('studioAlbums: one album per release group, from its earliest release, year from the group', () => {
  const albums = studioAlbums([
    release({ rg: 'mop', rgTitle: 'Master of Puppets', first: '1986-03-03', date: '2017-11-10', tracks: ['Battery', 'Bonus Demo Track'] }),
    release({ rg: 'mop', rgTitle: 'Master of Puppets', first: '1986-03-03', date: '1986-03-03', tracks: ['Battery', 'Master of Puppets'] }),
    release({ rg: 'kea', rgTitle: 'Kill ’Em All', first: '1983-07-25', date: '1983-07-25', tracks: ['Hit the Lights'] }),
  ]);
  assert.deepEqual(albums, [
    { title: 'Kill ’Em All', year: 1983, songs: ['Hit the Lights'] },
    { title: 'Master of Puppets', year: 1986, songs: ['Battery', 'Master of Puppets'] },
  ]);
});

test('studioAlbums skips live groups, compilation titles and video media', () => {
  const albums = studioAlbums([
    release({ rg: 'live', rgTitle: 'S&M', first: '1999-11-23', secondary: ['Live'], date: '1999-11-23', tracks: ['x'] }),
    release({ rg: 'gh', rgTitle: 'Greatest Hits', first: '2000-01-01', date: '2000-01-01', tracks: ['x'] }),
    release({
      rg: 'blk', rgTitle: 'Metallica', first: '1991-08-12', date: '1991-08-12', tracks: ['Enter Sandman'],
      extraMedia: [{ format: 'DVD-Video', tracks: [{ title: 'Enter Sandman (video)', recording: {} }] }],
    }),
  ]);
  assert.deepEqual(albums, [{ title: 'Metallica', year: 1991, songs: ['Enter Sandman'] }]);
});

test('studioAlbums filters demo/live versions only in brackets or after a dash', () => {
  const [album] = studioAlbums([release({
    rg: 'r', rgTitle: 'Ride the Lightning', first: '1984-07-27', date: '1984-07-27',
    tracks: ['Fight Fire With Fire', 'Battery (demo)', 'Orion - Live', 'Fade to Black (live)', 'Live Wire', 'Remixed Hearts'],
  })]);
  assert.deepEqual(album.songs, ['Fight Fire With Fire', 'Live Wire', 'Remixed Hearts']);
});

test('studioAlbums dedupes songs within an album and drops Hebrew titles', () => {
  const [album] = studioAlbums([release({
    rg: 'r', rgTitle: 'Album', first: '1990-01-01', date: '1990-01-01', tracks: ['Intro', 'Intro', 'שיר', 'Outro'],
  })]);
  assert.deepEqual(album.songs, ['Intro', 'Outro']);
});

test('dedupes unicode variants of the same album title, keeping the earliest', () => {
  const albums = studioAlbums([
    release({ rg: 'a', rgTitle: '…And Justice for All', first: '1988-08-25', date: '1988-08-25', tracks: ['Blackened'] }),
    release({ rg: 'b', rgTitle: '...And Justice for All', first: '2018-11-02', date: '2018-11-02', tracks: ['Blackened'] }),
    release({ rg: 'c', rgTitle: 'Hardwired… to Self‐Destruct', first: '2016-11-18', date: '2016-11-18', tracks: ['Atlas, Rise!'] }),
  ]);
  assert.deepEqual(albums.map((a) => [a.title, a.year]), [['…And Justice for All', 1988], ['Hardwired… to Self‐Destruct', 2016]]);
});

test('a song already on an earlier album of the artist is not repeated (re-recordings, spelling variants)', () => {
  const albums = studioAlbums([
    release({ rg: 'bbb', rgTitle: 'Bonded by Blood', first: '1985-04-25', date: '1985-04-25', tracks: ['Bonded by Blood', 'Piranha', 'Self‐Destruct'] }),
    release({ rg: 'ltbb', rgTitle: 'Let There Be Blood', first: '2008-10-24', date: '2008-10-24', tracks: ['Bonded by Blood', 'PIRANHA', 'Self-Destruct', 'New Song'] }),
  ]);
  assert.deepEqual(albums.map((a) => a.songs), [['Bonded by Blood', 'Piranha', 'Self‐Destruct'], ['New Song']]);
});

test('placeholder track titles are not songs', () => {
  const [album] = studioAlbums([release({
    rg: 'r', rgTitle: 'Album', first: '1990-01-01', date: '1990-01-01', tracks: ['[silence]', '[untitled]', '[data track]', 'Real Song'],
  })]);
  assert.deepEqual(album.songs, ['Real Song']);
});

test('different albums with the same title are kept when their songs differ (self-titled albums)', () => {
  const albums = studioAlbums([
    release({ rg: 'blue', rgTitle: 'Weezer', first: '1994-05-10', date: '1994-05-10', tracks: ['Buddy Holly', 'Say It Ain’t So'] }),
    release({ rg: 'green', rgTitle: 'Weezer', first: '2001-05-15', date: '2001-05-15', tracks: ['Hash Pipe', 'Island in the Sun'] }),
  ]);
  assert.deepEqual(albums.map((a) => [a.title, a.year]), [['Weezer', 1994], ['Weezer', 2001]]);
});

test('genreFiles: artists with their songs key, albums nested by artist', () => {
  const files = genreFiles([
    { name: 'Metallica', key: 'metallica', albums: [{ title: 'Kill ’Em All', year: 1983, songs: ['Hit the Lights'] }, { title: 'Master of Puppets', year: 1986, songs: ['Battery', 'Orion'] }] },
    { name: 'Slayer', key: 'slayer', albums: [{ title: 'Reign in Blood', year: 1986, songs: ['Angel of Death'] }] },
  ]);
  assert.deepEqual(files, {
    artists: [['Metallica', 'metallica'], ['Slayer', 'slayer']],
    albums: [
      ['Metallica', [['Kill ’Em All', 1983], ['Master of Puppets', 1986]]],
      ['Slayer', [['Reign in Blood', 1986]]],
    ],
  });
});

test('songList flattens the albums of an artist into song titles only', () => {
  assert.deepEqual(songList([{ title: 'A', year: 1983, songs: ['x', 'y'] }, { title: 'B', year: 1986, songs: ['z'] }]), ['x', 'y', 'z']);
});

test('artistKey: slug, with the id prefix for non-Latin names and repeated names', () => {
  const used = new Set();
  assert.equal(artistKey({ id: 'aaaaaaaa-1111', name: 'Metallica' }, used), 'metallica');
  assert.equal(artistKey({ id: 'bbbbbbbb-2222', name: 'Ария' }, used), 'artist-bbbbbbbb');
  assert.equal(artistKey({ id: 'cccccccc-3333', name: 'Metallica' }, used), 'metallica-cccccccc');
  assert.equal(artistKey({ id: 'dddddddd-4444', name: 'Guns N’ Roses' }, used), 'guns-n-roses');
});
