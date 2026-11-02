export const QUESTION_TYPES = ['band', 'album', 'song'];

// Same two items in either order are the same question.
export const pairKey = (q) => [q.a.id, q.b.id].sort().join('|');

// What the player sees on a button, ignoring case, punctuation and dash variants;
// two items that look the same are never paired.
const fold = (text) => text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
const shown = (item) => `${fold(item.title)}\u0000${fold(item.artist || '')}`;

export function createQuestionMaker({ sources, random = Math.random, maxTries = 5 }) {
  const index = (n) => Math.floor(random() * n);
  const pick = (list) => list[index(list.length)];

  // Two items that differ in what the player sees, or null after a few tries.
  function pickTwo(list, look = shown) {
    if (list.length < 2) return null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const i = index(list.length);
      let j = index(list.length - 1);
      if (j >= i) j += 1;
      if (look(list[i]) !== look(list[j])) return [list[i], list[j]];
    }
    return null;
  }

  // A song question draws two different artists and one song of each, so only their two
  // small song files are downloaded and every artist has the same chance.
  async function songPair(genre) {
    const artists = pickTwo(await sources.artists(genre), (a) => fold(a.name));
    if (!artists) return null;
    const [first, second] = await Promise.all(artists.map((a) => sources.songsOf(a)));
    if (!first.length || !second.length) return null;
    return [pick(first), pick(second)];
  }

  const pairFor = {
    band: async (g) => pickTwo(await sources.bands(g)),
    album: async (g) => pickTwo(await sources.albums(g)),
    song: songPair,
  };

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
        pair = await pairFor[type](genre);
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
