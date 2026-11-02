// Thrown by next() when reset() was called while it waited. Callers just ignore it.
export class StaleRoundError extends Error {
  constructor() {
    super('the round was reset');
    this.name = 'StaleRoundError';
  }
}

// Category-agnostic game loop: keeps `prefetch` questions ready and never repeats
// a pair within a round (until reset).
//
// Order of fetches: Q1 alone; once it arrives, Q2 and Q3; after each answer, one more.
export function createGame({
  makeQuestion, pairKey, prefetch = 2,
  yieldFn = () => new Promise((r) => setTimeout(r, 0)),
}) {
  let history = new Set();
  let queue = []; // slots: { promise, failed }
  let generation = 0;

  // Fetches until a pair not asked this round comes back. Resolves null if a reset made it stale.
  async function produce(gen) {
    for (;;) {
      const question = await makeQuestion();
      if (gen !== generation) return null;
      const k = pairKey(question);
      if (!history.has(k)) {
        history.add(k);
        return question;
      }
      await yieldFn();
      if (gen !== generation) return null;
    }
  }

  function start(gen) {
    const slot = { promise: produce(gen), failed: false };
    slot.promise.catch(() => { slot.failed = true; }); // also prevents unhandled rejections
    return slot;
  }

  function fill() {
    while (queue.length < prefetch) queue.push(start(generation));
  }

  async function next() {
    const gen = generation;
    queue = queue.filter((slot) => !slot.failed); // prefetches that failed (e.g. while offline) are dropped
    if (queue.length === 0) queue.push(start(gen));
    const head = queue.shift();
    let question;
    try {
      question = await head.promise;
    } catch (err) {
      if (gen !== generation) throw new StaleRoundError();
      throw err; // no refill here: the next call starts fresh, once the network is back
    }
    if (gen !== generation || !question) throw new StaleRoundError();
    fill();
    return question;
  }

  function reset() {
    generation += 1;
    history = new Set();
    queue = [];
  }

  return { next, reset };
}
