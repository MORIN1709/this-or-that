// Reads the static music data in data/ (a one-time snapshot from MusicBrainz and ListenBrainz):
//   index.json, artists/<genre>.json ([name, songsKey, photoUrl]), albums/<genre>.json ([title, year, coverRef])
// (data/songs/ is kept but not used by the game for now.)
// Each file is fetched once, when a game first needs it; a failed fetch is retried next time.
const itemId = (type, artist, title) => `${type}|${artist.toLowerCase()}|${title.toLowerCase()}`;

// Album cover: a MusicBrainz release id (checked at build time to have a front cover in the Cover Art
// Archive) or, when only another source had one, its full URL. URLs are stable, so the browser's own
// cache serves repeats.
export const coverUrl = (ref) => (ref.startsWith('https://') ? ref : `https://coverartarchive.org/release/${ref}/front-250`);

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

    bands: async (genre) => (await file('artists', genre)).map(([name, , image]) => ({ id: itemId('band', '', name), title: name, image })),

    albums: async (genre) => (await file('albums', genre)).flatMap(([artist, albums]) =>
      albums.map(([title, year, cover]) => ({ id: itemId('album', artist, title), title, artist, year, image: coverUrl(cover) }))),
  };
}
