// Pure functions for building the static music data. No network, no file system.
import { normalizeTitle, isStudioAlbum } from '../js/filters.js';

// MusicBrainz tags the data is built for. Rock and metal only.
export const GENRES = [
  'classic rock', 'hard rock', 'heavy metal', 'thrash metal', 'grunge', 'punk rock',
  'progressive rock', 'progressive metal', 'doom metal', 'death metal', 'black metal',
  'alternative rock', 'alternative metal', 'nu metal', 'glam metal', 'power metal',
  'stoner rock', 'new wave of british heavy metal',
];

const HEBREW = /[֐-׿]/;
const VIDEO_MEDIUM = /dvd|blu-?ray|video/i;
// A version, not a song: "(demo)", "[live at …]", "Orion - Live". "Live Wire" stays.
const NOT_A_SONG = /[([]\s*[^)\]]*\b(demo|live|remix|instrumental|karaoke)\b[^)\]]*[)\]]|\s-\s.*\b(demo|live|remix|instrumental|karaoke)\b/i;
// MusicBrainz placeholder titles such as "[silence]", "[untitled]", "[data track]".
const PLACEHOLDER = /^\[[^\]]*\]$/;
// Same song regardless of case, punctuation or unicode dashes.
const songKey = (title) => normalizeTitle(title) || title.toLowerCase();

export const slugify = (name) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// True when `genre` is among the artist's `maxRank` most-voted tags (noise filter: keeps Poison out of thrash).
export function isMainTag(tags, genre, maxRank = 5) {
  if (!Array.isArray(tags)) return false;
  const want = genre.toLowerCase();
  return tags
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, maxRank)
    .some((t) => t.name.toLowerCase() === want);
}

// Most-listened artists of the genre: first those with the genre among their top `strictRank`
// tags (tuned on real thrash data: keeps out Accept, The Exploited, Discharge), then, only if
// that leaves fewer than n, filled up from those with it among their top `looseRank` tags.
export function pickArtists(candidates, scores, genre, n = 30, strictRank = 3, looseRank = 5) {
  const ranked = candidates
    .filter((a) => !HEBREW.test(a.name) && (scores.get(a.id) || 0) > 0)
    .sort((a, b) => scores.get(b.id) - scores.get(a.id));
  const strict = ranked.filter((a) => isMainTag(a.tags, genre, strictRank));
  const loose = ranked.filter((a) => !strict.includes(a) && isMainTag(a.tags, genre, looseRank));
  return [...strict, ...loose].slice(0, n).map((a) => ({ id: a.id, name: a.name }));
}

function songsOf(release) {
  const seen = new Set();
  const songs = [];
  for (const medium of release.media || []) {
    if (VIDEO_MEDIUM.test(medium.format || '')) continue;
    for (const track of medium.tracks || []) {
      const title = track.title;
      if (!title || NOT_A_SONG.test(title) || PLACEHOLDER.test(title.trim()) || HEBREW.test(title)) continue;
      const key = songKey(title);
      if (seen.has(key)) continue;
      seen.add(key);
      songs.push(title);
    }
  }
  return songs;
}

// Studio albums of one artist, each from its earliest release (no deluxe bonus tracks), oldest first.
export function studioAlbums(releases) {
  const earliest = new Map(); // release-group id → release
  for (const r of releases) {
    const rg = r['release-group'];
    if (!rg || (rg['primary-type'] && rg['primary-type'] !== 'Album')) continue;
    if (!isStudioAlbum(rg) || HEBREW.test(rg.title)) continue;
    const cur = earliest.get(rg.id);
    if (!cur || (r.date || '9999') < (cur.date || '9999')) earliest.set(rg.id, r);
  }
  const albums = [...earliest.values()]
    .map((r) => {
      const rg = r['release-group'];
      return { title: rg.title, year: Number(rg['first-release-date'].slice(0, 4)), songs: songsOf(r) };
    })
    .sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

  // Same title is the same album only when the songs mostly match (a remaster), not for
  // different self-titled albums (Weezer's blue and green albums). The earliest one stays.
  const kept = [];
  for (const album of albums) {
    const key = normalizeTitle(album.title) || album.title;
    const twin = kept.find((k) => (normalizeTitle(k.title) || k.title) === key && sameSongs(k.songs, album.songs));
    if (!twin) kept.push(album);
  }

  // A song already on an earlier album (re-recordings, compilations of old songs) appears once.
  const seen = new Set();
  for (const album of kept) {
    album.songs = album.songs.filter((title) => {
      const k = songKey(title);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return kept;
}

function sameSongs(a, b) {
  const smaller = a.length <= b.length ? a : b;
  if (smaller.length === 0) return true; // nothing to compare: treat as the same album
  const other = new Set((smaller === a ? b : a).map(songKey));
  return smaller.filter((t) => other.has(songKey(t))).length / smaller.length >= 0.5;
}

// The three per-genre files, nested by artist (and album) so names aren't repeated per song.
export function genreFiles(entries) {
  return {
    artists: entries.map((e) => e.name),
    albums: entries.map((e) => [e.name, e.albums.map((a) => [a.title, a.year])]),
    songs: entries.map((e) => [e.name, e.albums.map((a) => [a.title, a.year, a.songs])]),
  };
}
