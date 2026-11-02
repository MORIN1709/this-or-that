export const QUESTION_TYPES = ['band', 'album', 'song'];

// Same two items in either order are the same question.
export const pairKey = (q) => [q.a.id, q.b.id].sort().join('|');

export function createQuestionMaker({ sources, genres, random = Math.random, maxTries = 5 }) {
  const index = (n) => Math.floor(random() * n);
  const pick = (list) => list[index(list.length)];
  const pickTwo = (list) => {
    const i = index(list.length);
    let j = index(list.length - 1);
    if (j >= i) j += 1;
    return [list[i], list[j]];
  };

  // Two different items of `type` from `genre`, or null when the genre is too thin.
  async function pairFor(type, genre) {
    if (type === 'band') {
      const bands = await sources.bands(genre);
      return bands.length >= 2 ? pickTwo(bands) : null;
    }
    const albums = await sources.albums(genre);
    if (type === 'album') return albums.length >= 2 ? pickTwo(albums) : null;

    if (albums.length === 0) return null;
    if (albums.length === 1) {
      const songs = await sources.songsFromAlbum(albums[0]);
      return songs.length >= 2 ? pickTwo(songs) : null;
    }
    const [x, y] = pickTwo(albums);
    const [sx, sy] = await Promise.all([sources.songsFromAlbum(x), sources.songsFromAlbum(y)]);
    if (!sx.length || !sy.length) return null;
    const a = pick(sx);
    const b = pick(sy);
    return a.id !== b.id ? [a, b] : null;
  }

  // Each attempt draws a fresh type and genre, so one thin type or genre can't block the game.
  async function makeQuestion() {
    const tried = [];
    for (let attempt = 0; attempt < maxTries; attempt++) {
      const type = pick(QUESTION_TYPES);
      const genre = pick(genres);
      tried.push(`${type}/${genre}`);
      const pair = await pairFor(type, genre);
      if (pair) {
        const [a, b] = random() < 0.5 ? pair : [pair[1], pair[0]];
        return { type, genre, a, b };
      }
    }
    throw new Error(`could not build a question: not enough items (tried ${tried.join(', ')})`);
  }

  return { makeQuestion };
}
