import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionMaker, pairKey } from '../js/questions.js';

// Deterministic random: returns the given values in order, repeating the last one.
function seq(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const items = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, title: `${prefix} ${i}` }));

function fakeSources({ bands = {}, albums = {}, songs = {} } = {}) {
  const calls = [];
  return {
    calls,
    bands: async (g) => { calls.push(['bands', g]); return bands[g] || []; },
    albums: async (g) => { calls.push(['albums', g]); return albums[g] || []; },
    songsFromAlbum: async (a) => { calls.push(['songs', a.id]); return songs[a.id] || []; },
  };
}

test('pairKey is order-independent', () => {
  assert.equal(pairKey({ a: { id: 'y' }, b: { id: 'x' } }), 'x|y');
  assert.equal(pairKey({ a: { id: 'x' }, b: { id: 'y' } }), 'x|y');
});

test('band question: two different bands of the drawn genre', async () => {
  const list = items('band', 4);
  const sources = fakeSources({ bands: { thrash: list } });
  // type 0 → band, genre 0 → thrash, pick i=0, j=0→1, order 0.9 → swapped
  const maker = createQuestionMaker({ sources, genres: ['thrash', 'grunge'], random: seq(0, 0, 0, 0, 0.9) });
  const q = await maker.makeQuestion();
  assert.equal(q.type, 'band');
  assert.equal(q.genre, 'thrash');
  assert.notEqual(q.a.id, q.b.id);
  assert.deepEqual([q.a.id, q.b.id].sort(), ['band0', 'band1']);
});

test('album question: two different albums of the drawn genre', async () => {
  const list = items('alb', 5);
  const sources = fakeSources({ albums: { doom: list } });
  const maker = createQuestionMaker({ sources, genres: ['doom'], random: seq(0.4, 0, 0.2, 0.6, 0.1) });
  const q = await maker.makeQuestion();
  assert.equal(q.type, 'album');
  assert.equal(q.genre, 'doom');
  assert.notEqual(q.a.id, q.b.id);
  assert.ok(list.includes(q.a) && list.includes(q.b));
});

test('song question: one song from each of two different albums', async () => {
  const [x, y] = items('alb', 2);
  const sx = items('x-song', 3);
  const sy = items('y-song', 3);
  const sources = fakeSources({ albums: { punk: [x, y] }, songs: { [x.id]: sx, [y.id]: sy } });
  // type 0.7 → song, genre 0, albums i=0 j→1, song picks 0 and 0, order 0.1 → kept
  const maker = createQuestionMaker({ sources, genres: ['punk'], random: seq(0.7, 0, 0, 0, 0, 0, 0.1) });
  const q = await maker.makeQuestion();
  assert.equal(q.type, 'song');
  assert.ok(sx.includes(q.a), 'a comes from the first album');
  assert.ok(sy.includes(q.b), 'b comes from the second album');
});

test('song question: two different songs when the genre has one album', async () => {
  const [x] = items('alb', 1);
  const sx = items('x-song', 4);
  const sources = fakeSources({ albums: { punk: [x] }, songs: { [x.id]: sx } });
  const maker = createQuestionMaker({ sources, genres: ['punk'], random: seq(0.7, 0, 0, 0, 0.1) });
  const q = await maker.makeQuestion();
  assert.equal(q.type, 'song');
  assert.notEqual(q.a.id, q.b.id);
  assert.ok(sx.includes(q.a) && sx.includes(q.b));
});

test('retries another genre when the first has fewer than 2 items', async () => {
  const sources = fakeSources({ bands: { g1: [], g2: items('band', 3) } });
  // attempt 1: type 0 → band, genre 0 → g1 (empty); attempt 2: type 0 → band, genre 0.6 → g2
  const maker = createQuestionMaker({ sources, genres: ['g1', 'g2'], random: seq(0, 0, 0, 0.6, 0, 0, 0.1) });
  const q = await maker.makeQuestion();
  assert.equal(q.genre, 'g2');
});

test('re-rolls the question type too when a genre is thin', async () => {
  const sources = fakeSources({ albums: { g1: [] }, bands: { g1: items('band', 3) } });
  // attempt 1: type 0.4 → album (none); attempt 2: type 0 → band
  const maker = createQuestionMaker({ sources, genres: ['g1'], random: seq(0.4, 0, 0, 0, 0, 0, 0.1) });
  const q = await maker.makeQuestion();
  assert.equal(q.type, 'band');
});

test('throws after maxTries, naming what was tried', async () => {
  const sources = fakeSources();
  const maker = createQuestionMaker({ sources, genres: ['g1', 'g2'], random: seq(0, 0, 0, 0.6, 0), maxTries: 3 });
  await assert.rejects(maker.makeQuestion(), /band\/g1.*band\/g2/);
});

test('tries 5 type/genre combinations by default', async () => {
  const sources = fakeSources();
  const maker = createQuestionMaker({ sources, genres: ['g1'], random: seq(0) });
  await assert.rejects(maker.makeQuestion());
  assert.equal(sources.calls.length, 5);
});
