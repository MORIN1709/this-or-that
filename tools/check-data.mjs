// Checks that a data/ folder has exactly the shape the site reads (js/data-source.js):
//
//   index.json               { genres: [{ slug, name, counts: { artists, albums, songs } }] }
//   artists/<slug>.json      [["Artist", "songs-key"], …]
//   albums/<slug>.json       [["Artist", [["Album", 1986], …]], …]
//   songs/<songs-key>.json   ["Song", …]                       (one file per artist, shared by genres)
//
//   node tools/check-data.mjs [dir]        (default: data)
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isYear = (v) => Number.isInteger(v) && v > 1900 && v < 2100;

async function readJson(dir, path, errors) {
  try {
    return JSON.parse(await readFile(join(dir, path), 'utf8'));
  } catch (err) {
    errors.push(`${path}: ${err.code === 'ENOENT' ? 'missing' : `not valid JSON (${err.message})`}`);
    return undefined;
  }
}

// Returns the [name, key] entries, or null when the file has the wrong shape.
function checkArtists(path, value, errors) {
  const ok = Array.isArray(value) && value.every((e) => Array.isArray(e) && e.length === 2 && isText(e[0]) && isText(e[1]));
  if (!ok) {
    errors.push(`${path}: expected an array of ["Artist", "songs-key"]`);
    return null;
  }
  return value;
}

// Returns the number of albums, or -1 when the file has the wrong shape.
function checkAlbums(path, value, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected an array of [artist, albums]`);
    return -1;
  }
  let count = 0;
  for (const entry of value) {
    const [artist, albums] = Array.isArray(entry) ? entry : [];
    const name = isText(artist) ? artist : JSON.stringify(entry).slice(0, 40);
    if (!isText(artist) || !Array.isArray(albums)) {
      errors.push(`${path}: entry ${name} should be [artist, albums]`);
      return -1;
    }
    for (const album of albums) {
      if (!(Array.isArray(album) && album.length === 2 && isText(album[0]) && isYear(album[1]))) {
        errors.push(`${path}: ${name} has an album that is not ["Album", year]: ${JSON.stringify(album).slice(0, 60)}`);
        return -1;
      }
      count += 1;
    }
  }
  return count;
}

export async function checkData(dir = 'data') {
  const errors = [];
  const index = await readJson(dir, 'index.json', errors);
  if (!index) {
    if (errors.length === 0) errors.push('index.json: empty');
    return { ok: false, errors };
  }
  if (!Array.isArray(index.genres) || index.genres.length === 0) {
    errors.push('index.json: expected a non-empty "genres" array');
    return { ok: false, errors };
  }
  // Song files are shared between genres, so each is read and checked once.
  const songCounts = new Map();
  async function songCount(key) {
    if (!songCounts.has(key)) {
      const path = `songs/${key}.json`;
      const value = await readJson(dir, path, errors);
      let n = -1;
      if (value !== undefined) {
        if (Array.isArray(value) && value.every(isText)) n = value.length;
        else errors.push(`${path}: expected an array of song titles`);
      }
      songCounts.set(key, n);
    }
    return songCounts.get(key);
  }

  for (const genre of index.genres) {
    if (!isText(genre.slug) || !isText(genre.name)) {
      errors.push(`index.json: genre ${JSON.stringify(genre).slice(0, 60)} needs "slug" and "name"`);
      continue;
    }
    const artists = checkArtists(`artists/${genre.slug}.json`, await readJson(dir, `artists/${genre.slug}.json`, errors), errors);
    const found = {
      artists: artists ? artists.length : -1,
      albums: checkAlbums(`albums/${genre.slug}.json`, await readJson(dir, `albums/${genre.slug}.json`, errors), errors),
      songs: -1,
    };
    if (artists) {
      let total = 0;
      let withSongs = 0;
      for (const [, key] of artists) {
        const n = await songCount(key);
        if (n > 0) withSongs += 1;
        total += Math.max(n, 0);
      }
      found.songs = total;
      if (withSongs < 2) errors.push(`artists/${genre.slug}.json: a song question needs at least 2 artists with songs, has ${withSongs}`);
    }
    for (const [type, n] of Object.entries(found)) {
      if (n < 0) continue;
      if (type !== 'songs' && n < 2) errors.push(`${type}/${genre.slug}.json: needs at least 2 items for a question, has ${n}`);
      const claimed = genre.counts && genre.counts[type];
      if (claimed !== undefined && claimed !== n) errors.push(`index.json: ${genre.slug} counts.${type} is ${claimed} but the files have ${n}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] || 'data';
  checkData(dir).then(({ ok, errors }) => {
    if (ok) console.log(`${dir}: OK`);
    else { console.error(`${dir}: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`); process.exit(1); }
  });
}
