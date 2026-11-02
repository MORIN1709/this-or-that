import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, StaleRoundError } from '../js/game.js';
import { pairKey } from '../js/questions.js';

const q = (x, y) => ({ type: 'band', genre: 'g', a: { id: x }, b: { id: y } });
const key = (question) => pairKey(question);

// makeQuestion that answers from a list of keys like 'x|y', then unique pairs forever.
function scripted(keys) {
  let n = 0;
  const fn = async () => {
    const k = n < keys.length ? keys[n] : `u${n}|v${n}`;
    n += 1;
    const [x, y] = k.split('|');
    return q(x, y);
  };
  fn.count = () => n;
  return fn;
}

// makeQuestion whose answers the test releases by hand.
function manual() {
  const pending = [];
  const fn = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  fn.pending = pending;
  return fn;
}

const immediate = async () => {};

test('first question is fetched alone; Q2 and Q3 start once it arrives', async () => {
  const makeQuestion = manual();
  const game = createGame({ makeQuestion, pairKey, prefetch: 2 });
  const first = game.next();
  assert.equal(makeQuestion.pending.length, 1, 'only Q1 in flight before it arrives');
  makeQuestion.pending[0].resolve(q('a', 'b'));
  assert.equal(key(await first), 'a|b');
  assert.equal(makeQuestion.pending.length, 3, 'Q2 and Q3 started after Q1 arrived');
});

test('each answer starts exactly one new fetch, keeping 2 ready', async () => {
  const makeQuestion = scripted([]);
  const game = createGame({ makeQuestion, pairKey, prefetch: 2, yieldFn: immediate });
  await game.next();
  assert.equal(makeQuestion.count(), 3);
  await game.next();
  assert.equal(makeQuestion.count(), 4);
  await game.next();
  assert.equal(makeQuestion.count(), 5);
});

test('skips a pair already asked in this round', async () => {
  const game = createGame({ makeQuestion: scripted(['x|y', 'x|y', 'x|z']), pairKey, prefetch: 1, yieldFn: immediate });
  assert.equal(key(await game.next()), 'x|y');
  assert.equal(key(await game.next()), 'x|z');
});

test('keeps fetching until the pair is not a duplicate, with no try limit', async () => {
  const keys = ['x|y', ...Array(10).fill('y|x'), 'x|z'];
  const makeQuestion = scripted(keys);
  const game = createGame({ makeQuestion, pairKey, prefetch: 1, yieldFn: immediate });
  assert.equal(key(await game.next()), 'x|y');
  assert.equal(key(await game.next()), 'x|z');
  assert.ok(makeQuestion.count() >= 12);
});

test('reset drops prefetched questions from before the reset', async () => {
  const makeQuestion = manual();
  const game = createGame({ makeQuestion, pairKey, prefetch: 1 });
  const first = game.next();
  makeQuestion.pending[0].resolve(q('a', 'b'));
  await first;
  assert.equal(makeQuestion.pending.length, 2, 'Q2 in flight');
  game.reset();
  const afterReset = game.next();
  makeQuestion.pending[1].resolve(q('stale', 'pair')); // old Q2 arrives late
  makeQuestion.pending[2].resolve(q('fresh', 'pair'));
  assert.equal(key(await afterReset), 'fresh|pair');
});

test('reset clears the round history', async () => {
  const game = createGame({ makeQuestion: scripted(['x|y', 'x|y', 'x|y', 'x|y']), pairKey, prefetch: 1 });
  assert.equal(key(await game.next()), 'x|y');
  game.reset();
  assert.equal(key(await game.next()), 'x|y');
});

test('after a dropped connection, the first retry works (failed prefetches are not served)', async () => {
  let offline = true;
  let n = 0;
  const makeQuestion = async () => {
    n += 1;
    if (offline) throw new Error('offline');
    return q(`a${n}`, `b${n}`);
  };
  const game = createGame({ makeQuestion, pairKey, prefetch: 2, yieldFn: immediate });
  await assert.rejects(game.next(), /offline/);
  await new Promise((r) => setTimeout(r, 10)); // let anything started while offline settle
  offline = false;
  const question = await game.next();
  assert.ok(question.a.id.startsWith('a'));
});

test('mid-game drop: failed prefetched slots are skipped once back online', async () => {
  let offline = false;
  let n = 0;
  const makeQuestion = async () => {
    n += 1;
    if (offline) throw new Error('offline');
    return q(`a${n}`, `b${n}`);
  };
  const game = createGame({ makeQuestion, pairKey, prefetch: 2, yieldFn: immediate });
  offline = true;                       // Q2 and Q3 will fail
  await game.next().catch(() => {});    // Q1 also fails
  offline = false;
  await game.next();                    // first tap after reconnect
});

test('reset while waiting: the stale call rejects as stale and fetches nothing extra', async () => {
  const makeQuestion = manual();
  const game = createGame({ makeQuestion, pairKey, prefetch: 1 });
  const stale = game.next();            // call 1 pending
  game.reset();
  const fresh = game.next();            // call 2 pending
  makeQuestion.pending[0].resolve(q('old', 'pair'));
  await assert.rejects(stale, (err) => err instanceof StaleRoundError);
  makeQuestion.pending[1].resolve(q('new', 'pair'));
  assert.equal(key(await fresh), 'new|pair');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(makeQuestion.pending.length, 3, 'only the one prefetch after the fresh question');
});

test('a failed fetch rejects next(), and the following next() recovers', async () => {
  let calls = 0;
  const makeQuestion = async () => {
    calls += 1;
    if (calls === 1) throw new Error('network down');
    return q(`a${calls}`, `b${calls}`);
  };
  const game = createGame({ makeQuestion, pairKey, prefetch: 2, yieldFn: immediate });
  await assert.rejects(game.next(), /network down/);
  const recovered = await game.next();
  assert.ok(recovered.a.id.startsWith('a'));
});
