// King of the hill: two items on screen; the chosen one stays (the king) and a new challenger from
// the same list replaces the other. A loser or skipped challenger never comes back. When no
// challengers are left the game is over and the last king is the winner.
export function createHill(items, { random = Math.random } = {}) {
  if (items.length < 2) throw new Error('a hill needs at least 2 items');

  // Fisher–Yates shuffle of the challengers' order.
  const queue = items.slice();
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }

  const pair = [queue.shift(), queue.shift()];
  let kingSide = null;
  let winner = null;

  function nextChallenger() {
    if (queue.length === 0) {
      winner = pair[kingSide];
      return false;
    }
    pair[1 - kingSide] = queue.shift();
    return true;
  }

  return {
    get pair() { return pair; },
    get kingSide() { return kingSide; },
    get done() { return winner !== null; },
    get winner() { return winner; },

    choose(side) {
      kingSide = side;
      nextChallenger();
    },

    // A new challenger against the king; before the first choice, two new items.
    skip() {
      if (kingSide !== null) {
        nextChallenger();
      } else if (queue.length >= 2) {
        pair[0] = queue.shift();
        pair[1] = queue.shift();
      }
    },

    // The next n challengers, so their pictures can be loaded ahead.
    upcoming(n) {
      return queue.slice(0, n);
    },
  };
}
