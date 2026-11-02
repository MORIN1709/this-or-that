// Reads the static music data in data/ (built once by tools/build-data.mjs):
//   index.json, artists/<genre>.json ([name, songsKey]), albums/<genre>.json, songs/<songsKey>.json
// Each file is fetched once, when a question first needs it; a failed fetch is retried next time.
const itemId = (type, artist, title) => `${type}|${artist.toLowerCase()}|${title.toLowerCase()}`;

export function createDataSource({ fetchImpl = (...a) => fetch(...a), base = 'data/', timeoutMs = 15000 } = {}) {
  const cache = new Map();

  // A stalled download (weak mobile signal) is aborted, so the player gets "try again" instead of endless loading.
  function load(path) {
    if (!cache.has(path)) {
      const p = (async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await fetchImpl(base + path, { signal: ctrl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${base}${path}`);
          return await res.json();
        } finally {
          clearTimeout(timer);
        }
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

    bands: async (genre) => (await file('artists', genre)).map(([name]) => ({ id: itemId('band', '', name), title: name })),

    albums: async (genre) => (await file('albums', genre)).flatMap(([artist, albums]) =>
      albums.map(([title, year]) => ({ id: itemId('album', artist, title), title, artist, year }))),

    // Song questions draw two artists, then load only those two artists' song files.
    artists: async (genre) => (await file('artists', genre)).map(([name, key]) => ({ name, key })),

    songsOf: async ({ name, key }) => (await load(`songs/${key}.json`))
      .map((title) => ({ id: itemId('song', name, title), title, artist: name })),
  };
}
