export const QUESTION_TYPES = ['band', 'album', 'song'];

// Same two items in either order are the same question.
export const pairKey = (q) => [q.a.id, q.b.id].sort().join('|');

// What the player sees on a button; two items with the same text are never paired.
const shown = (item) => `${item.title}\u0000${item.artist || ''}`;

export function createQuestionMaker({ sources, random = Math.random, maxTries = 5 }) {
  const index = (n) => Math.floor(random() * n);
  const pick = (list) => list[index(list.length)];

  // Two items that differ in what the player sees, or null after a few tries.
  function pickTwo(list) {
    if (list.length < 2) return null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const i = index(list.length);
      let j = index(list.length - 1);
      if (j >= i) j += 1;
      if (shown(list[i]) !== shown(list[j])) return [list[i], list[j]];
    }
    return null;
  }

  const listFor = { band: (g) => sources.bands(g), album: (g) => sources.albums(g), song: (g) => sources.songs(g) };

  // Each attempt draws a fresh type and genre, so one thin or unloadable genre can't block the game.
  async function makeQuestion() {
    const genres = await sources.genres();
    const tried = [];
    for (let attempt = 0; attempt < maxTries; attempt++) {
      const type = pick(QUESTION_TYPES);
      const genre = pick(genres);
      tried.push(`${type}/${genre}`);
      let pair = null;
      try {
        pair = pickTwo(await listFor[type](genre));
      } catch (err) {
        console.warn(`Could not load ${type} data for "${genre}":`, err.message);
      }
      if (pair) {
        const [a, b] = random() < 0.5 ? pair : [pair[1], pair[0]];
        return { type, genre, a, b };
      }
    }
    throw new Error(`could not build a question: not enough items (tried ${tried.join(', ')})`);
  }

  return { makeQuestion };
}
