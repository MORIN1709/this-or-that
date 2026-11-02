// Reads the static music data in data/ (built once by tools/build-data.mjs).
// Each file is fetched once, when a question first needs it; a failed fetch is retried next time.
const itemId = (type, artist, title) => `${type}|${artist.toLowerCase()}|${title.toLowerCase()}`;

export function createDataSource({ fetchImpl = (...a) => fetch(...a), base = 'data/' } = {}) {
  const cache = new Map();

  function load(path) {
    if (!cache.has(path)) {
      const p = (async () => {
        const res = await fetchImpl(base + path);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${base}${path}`);
        return res.json();
      })();
      cache.set(path, p);
      p.catch(() => cache.delete(path));
    }
    return cache.get(path);
  }

  async function file(type, genre) {
    const index = await load('index.json');
    const entry = index.genres.find((g) => g.name === genre);
    if (!entry) throw new Error(`unknown genre "${genre}"`);
    return load(`${type}/${entry.slug}.json`);
  }

  return {
    genres: async () => (await load('index.json')).genres.map((g) => g.name),

    bands: async (genre) => (await file('artists', genre)).map((name) => ({ id: itemId('band', '', name), title: name })),

    albums: async (genre) => (await file('albums', genre)).flatMap(([artist, albums]) =>
      albums.map(([title, year]) => ({ id: itemId('album', artist, title), title, artist, year }))),

    songs: async (genre) => (await file('songs', genre)).flatMap(([artist, albums]) =>
      albums.flatMap(([, year, songs]) => songs.map((title) => ({ id: itemId('song', artist, title), title, artist, year })))),
  };
}
