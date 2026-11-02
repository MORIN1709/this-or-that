import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionMaker, pairKey } from '../js/questions.js';

// Deterministic random: returns the given values in order, repeating the last one.
function seq(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const items = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, title: `${prefix} ${i}` }));

// `lists[type][genre]` is an array, or an Error to simulate a file that fails to load.
function fakeSources({ genres = ['g1'], bands = {}, albums = {}, songs = {} } = {}) {
  const calls = [];
  const answer = (list) => {
    if (list instanceof Error) throw list;
    return list || [];
  };
  return {
    calls,
    genres: async () => genres,
    bands: async (g) => { calls.push(['bands', g]); return answer(bands[g]); },
    albums: async (g) => { calls.push(['albums', g]); return answer(albums[g]); },
    songs: async (g) => { calls.push(['songs', g]); return answer(songs[g]); },
  };
}

test('pairKey is order-independent', () => {
  assert.equal(pairKey({ a: { id: 'y' }, b: { id: 'x' } }), 'x|y');
  assert.equal(pairKey({ a: { id: 'x' }, b: { id: 'y' } }), 'x|y');
});

test('band question: two different bands of the drawn genre', async () => {
  const list = items('band', 4);
  const sources = fakeSources({ genres: ['thrash', 'grunge'], bands: { thrash: list } });
  // type 0 → band, genre 0 → thrash, pick i=0, j=0→1, order 0.9 → swapped
  const maker = createQuestionMaker({ sources, random: seq(0, 0, 0, 0, 0.9) });
  const q = await maker.makeQuestion();
  assert.equal(q.type, 'band');
  assert.equal(q.genre, 'thrash');
  assert.deepEqual([q.a.id, q.b.id].sort(), ['band0', 'band1']);
});

test('album question: two different albums of the drawn genre', async () => {
  const list = items('alb', 5);
  const sources = fakeSources({ genres: ['doom'], albums: { doom: list } });
  const maker = createQuestionMaker({ sources, random: seq(0.4, 0, 0.2, 0.6, 0.1) });
  const q = await maker.makeQuestion();
  assert.equal(q.type, 'album');
  assert.equal(q.genre, 'doom');
  assert.notEqual(q.a.id, q.b.id);
  assert.ok(list.includes(q.a) && list.includes(q.b));
});

test('song question: two different songs from all songs of the genre', async () => {
  const list = items('song', 6);
  const sources = fakeSources({ genres: ['punk'], songs: { punk: list } });
  // type 0.7 → song, genre 0, pick i=0.5→3, j=0.9→4→5, order 0.1
  const maker = createQuestionMaker({ sources, random: seq(0.7, 0, 0.5, 0.9, 0.1) });
  const q = await maker.makeQuestion();
  assert.equal(q.type, 'song');
  assert.deepEqual([q.a.id, q.b.id].sort(), ['song3', 'song5']);
  assert.deepEqual(sources.calls, [['songs', 'punk']]);
});

test('never pairs items with the same displayed text', async () => {
  const songs = [
    { id: 's0', title: 'Intro', artist: 'Band' },
    { id: 's1', title: 'Intro', artist: 'Band' },
    { id: 's2', title: 'Battery', artist: 'Band' },
  ];
  const sources = fakeSources({ genres: ['g1'], songs: { g1: songs } });
  // type song, genre g1; first pick 0 & 1 (both "Intro") is rejected; second pick 0 & 2
  const maker = createQuestionMaker({ sources, random: seq(0.7, 0, 0, 0, 0, 0.6, 0.1) });
  const q = await maker.makeQuestion();
  assert.deepEqual([q.a.title, q.b.title].sort(), ['Battery', 'Intro']);
});

test('a missing genre file falls back to another genre', async () => {
  const sources = fakeSources({ genres: ['g1', 'g2'], songs: { g1: new Error('HTTP 404'), g2: items('song', 3) } });
  // attempt 1: song/g1 fails; attempt 2: song/g2
  const maker = createQuestionMaker({ sources, random: seq(0.7, 0, 0.7, 0.6, 0, 0, 0.1) });
  const original = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const q = await maker.makeQuestion();
    assert.equal(q.genre, 'g2');
  } finally {
    console.warn = original;
  }
  assert.ok(warnings.some((w) => w.includes('g1') && w.includes('404')), warnings.join('\n'));
});

test('retries another genre when the first has fewer than 2 items', async () => {
  const sources = fakeSources({ genres: ['g1', 'g2'], bands: { g1: [], g2: items('band', 3) } });
  // attempt 1: type 0 → band, genre 0 → g1 (empty); attempt 2: type 0 → band, genre 0.6 → g2
  const maker = createQuestionMaker({ sources, random: seq(0, 0, 0, 0.6, 0, 0, 0.1) });
  const q = await maker.makeQuestion();
  assert.equal(q.genre, 'g2');
});

test('re-rolls the question type too when a genre is thin', async () => {
  const sources = fakeSources({ albums: { g1: [] }, bands: { g1: items('band', 3) } });
  // attempt 1: type 0.4 → album (none); attempt 2: type 0 → band
  const maker = createQuestionMaker({ sources, random: seq(0.4, 0, 0, 0, 0, 0, 0.1) });
  const q = await maker.makeQuestion();
  assert.equal(q.type, 'band');
});

test('throws after maxTries, naming what was tried', async () => {
  const sources = fakeSources({ genres: ['g1', 'g2'] });
  const maker = createQuestionMaker({ sources, random: seq(0, 0, 0, 0.6, 0), maxTries: 3 });
  await assert.rejects(maker.makeQuestion(), /band\/g1.*band\/g2/);
});

test('tries 5 type/genre combinations by default', async () => {
  const sources = fakeSources();
  const maker = createQuestionMaker({ sources, random: seq(0) });
  await assert.rejects(maker.makeQuestion());
  assert.equal(sources.calls.length, 5);
});
