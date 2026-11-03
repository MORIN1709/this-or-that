import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHill } from '../js/hill.js';

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, title: `Item ${i}` }));
const noShuffle = () => 0.999999; // with this random, the shuffle keeps the original order
const ids = (pair) => pair.map((x) => x.id);

test('starts with two different items and no king', () => {
  const hill = createHill(items(5), { random: noShuffle });
  assert.equal(hill.pair.length, 2);
  assert.notEqual(hill.pair[0].id, hill.pair[1].id);
  assert.equal(hill.kingSide, null);
  assert.equal(hill.done, false);
});

test('choosing keeps the winner on its side as king and brings a new challenger on the other side', () => {
  const hill = createHill(items(5), { random: noShuffle });
  const [a, b] = hill.pair;
  hill.choose(1);
  assert.equal(hill.kingSide, 1);
  assert.equal(hill.pair[1], b, 'the king stays where it was');
  assert.notEqual(hill.pair[0], a, 'the loser is replaced');
  assert.ok(![a.id, b.id].includes(hill.pair[0].id));
});

test('a loser never comes back: every item appears at most once in a game', () => {
  const all = items(8);
  const hill = createHill(all, { random: Math.random });
  const seen = new Set(ids(hill.pair));
  while (!hill.done) {
    const side = hill.kingSide ?? 0;
    hill.choose(side);
    if (hill.done) break;
    const challenger = hill.pair[1 - side];
    assert.ok(!seen.has(challenger.id), `${challenger.id} came back`);
    seen.add(challenger.id);
  }
  assert.equal(seen.size, all.length);
});

test('the game ends when no challengers are left; the winner is the last king', () => {
  const hill = createHill(items(3), { random: noShuffle });
  hill.choose(0); // i0 beats i1, i2 comes in
  assert.equal(hill.done, false);
  const king = hill.pair[0];
  hill.choose(0); // i0 beats i2, nobody left
  assert.equal(hill.done, true);
  assert.equal(hill.winner, king);
});

test('skip replaces only the challenger once there is a king', () => {
  const hill = createHill(items(6), { random: noShuffle });
  hill.choose(0);
  const king = hill.pair[0];
  const challenger = hill.pair[1];
  hill.skip();
  assert.equal(hill.pair[0], king);
  assert.notEqual(hill.pair[1], challenger);
  assert.equal(hill.kingSide, 0);
});

test('skip before any choice replaces both items', () => {
  const hill = createHill(items(6), { random: noShuffle });
  const before = ids(hill.pair);
  hill.skip();
  assert.ok(ids(hill.pair).every((id) => !before.includes(id)), `${ids(hill.pair)} vs ${before}`);
  assert.equal(hill.kingSide, null);
});

test('skipping the last challenger ends the game with the king as winner', () => {
  const hill = createHill(items(3), { random: noShuffle });
  hill.choose(1);
  const king = hill.pair[1];
  hill.skip();
  assert.equal(hill.done, true);
  assert.equal(hill.winner, king);
});

test('upcoming(n) lists the next challengers, for preloading their pictures', () => {
  const hill = createHill(items(6), { random: noShuffle });
  const next = hill.upcoming(2);
  assert.equal(next.length, 2);
  hill.choose(0);
  assert.equal(hill.pair[1], next[0]);
});

test('needs at least two items', () => {
  assert.throws(() => createHill(items(1)), /at least 2/);
});
