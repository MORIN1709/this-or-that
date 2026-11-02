// Dated concert recordings ("1995-06-10: Cabaret Metro") are bootlegs, not albums.
const CONCERT_TITLE = /^\d{4}\s*[-‐‑–./]\s*\d{1,2}\s*[-‐‑–./]\s*\d{1,2}\b|^\d{1,2}\s\d{1,2}\s\d{2}\b/;
// Compilations and live albums MusicBrainz sometimes leaves untyped.
const NOT_STUDIO_TITLE =
  /\b(greatest hits|best of|the very best|anthology|compilation|unplugged|live (at|in|from|on)|in concert|karaoke|tribute to|b-?sides|rarities|remixes)\b/i;
const EDITION_WORDS = /\b(super )?(deluxe|remaster(ed)?|expanded|anniversary|edition|version|bonus|reissue)\b.*$/g;

export function normalizeTitle(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(EDITION_WORDS, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isStudioAlbum(rg) {
  return Boolean(rg['first-release-date'])
    && !(rg['secondary-types'] || []).length
    && !CONCERT_TITLE.test(rg.title)
    && !NOT_STUDIO_TITLE.test(rg.title);
}

export function dedupeAlbums(albums) {
  const byKey = new Map();
  for (const a of albums) {
    const key = `${a.artist.toLowerCase()}|${normalizeTitle(a.title)}`;
    const cur = byKey.get(key);
    if (!cur || (a.year || '9999') < (cur.year || '9999')) byKey.set(key, a);
  }
  return [...byKey.values()];
}

export function topByScore(items, scores, n) {
  return items
    .filter((i) => (scores.get(i.id) || 0) > 0)
    .sort((a, b) => scores.get(b.id) - scores.get(a.id))
    .slice(0, n);
}
