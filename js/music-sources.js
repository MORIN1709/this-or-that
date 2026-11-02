import { CANDIDATE_OFFSETS, PAGE_LIMIT, TOP_N } from './config.js';
import { isStudioAlbum, dedupeAlbums, topByScore } from './filters.js';

const VIDEO_MEDIUM = /dvd|blu-?ray|video/i;
const NOT_A_SONG = /\b(demo|live|instrumental|karaoke|remix)\b/i;
// No Israeli music: Israeli artists are excluded by country in the artist search; albums and
// songs (whose search has no artist country) are dropped when written in Hebrew script.
const HEBREW = /[֐-׿]/;

// Keeps the promise per key; a rejected promise is dropped so the next call retries.
function memo(cache, key, fn) {
  if (!cache.has(key)) {
    const p = fn();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return cache.get(key);
}

const creditName = (credit) => (credit || []).map((c) => c.name + (c.joinphrase || '')).join('') || '?';

export function createMusicSources({ mb, lb }) {
  const cache = { bands: new Map(), albums: new Map(), songs: new Map() };

  // Reads up to CANDIDATE_OFFSETS.length pages of a tag search, stopping early when the results run out.
  async function searchPages(path, query, key) {
    const results = [];
    for (const offset of CANDIDATE_OFFSETS) {
      const page = await mb.get(path, { query, limit: PAGE_LIMIT, offset });
      if (!Array.isArray(page && page[key])) {
        console.warn(`MusicBrainz ${path}: no "${key}" array in the response. Keys:`, Object.keys(page || {}).join(', '));
        break;
      }
      results.push(...page[key]);
      if (typeof page?.count === 'number' && offset + PAGE_LIMIT >= page.count) break;
    }
    return results;
  }

  async function rank(entity, items, tag) {
    const unique = [...new Map(items.map((i) => [i.id, i])).values()];
    if (unique.length === 0) return [];
    const scores = await lb.popularity(entity, unique.map((i) => i.id));
    const top = topByScore(unique, scores, TOP_N);
    if (top.length === 0) {
      console.warn(`ListenBrainz gave no popularity for any of ${unique.length} ${entity} candidates of tag "${tag}"`);
    }
    return top;
  }

  function bands(tag) {
    return memo(cache.bands, tag, async () => {
      const artists = await searchPages('/artist', `tag:"${tag}" AND (type:group OR type:person) AND NOT country:IL`, 'artists');
      const items = artists.filter((a) => !HEBREW.test(a.name)).map((a) => ({ id: a.id, title: a.name }));
      return rank('artist', items, tag);
    });
  }

  function albums(tag) {
    return memo(cache.albums, tag, async () => {
      const groups = await searchPages('/release-group', `tag:"${tag}" AND primarytype:album AND status:official`, 'release-groups');
      const studio = groups.filter(isStudioAlbum).map((rg) => ({
        id: rg.id,
        title: rg.title,
        artist: creditName(rg['artist-credit']),
        year: rg['first-release-date'].slice(0, 4),
      })).filter((a) => !HEBREW.test(a.title + a.artist));
      return rank('release-group', dedupeAlbums(studio), tag);
    });
  }

  // Every song of the album's original official release (avoids deluxe bonus tracks).
  function songsFromAlbum(album) {
    return memo(cache.songs, album.id, async () => {
      const rg = await mb.get(`/release-group/${album.id}`, { inc: 'releases' });
      const releases = (rg && rg.releases) || [];
      const official = releases.filter((r) => r.status === 'Official');
      const [first] = (official.length ? official : releases)
        .slice()
        .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
      if (!first) return [];
      const release = await mb.get(`/release/${first.id}`, { inc: 'recordings' });
      const tracks = ((release && release.media) || [])
        .filter((m) => !VIDEO_MEDIUM.test(m.format || ''))
        .flatMap((m) => m.tracks || [])
        .filter((t) => t.recording && t.recording.id && !NOT_A_SONG.test(t.title) && !HEBREW.test(t.title));
      const songs = tracks.map((t) => ({ id: t.recording.id, title: t.title, artist: album.artist, year: album.year }));
      return [...new Map(songs.map((s) => [s.id, s])).values()];
    });
  }

  return { bands, albums, songsFromAlbum };
}
