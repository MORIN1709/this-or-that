// Checks that a data/ folder has exactly the shape the site reads (js/data-source.js):
//
//   index.json               { genres: [{ slug, name, counts: { artists, albums, songs } }] }
//   artists/<slug>.json      ["Artist", …]
//   albums/<slug>.json       [["Artist", [["Album", 1986], …]], …]
//   songs/<slug>.json        [["Artist", [["Album", 1986, ["Song", …]], …]], …]
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

// Each check returns the number of items it found, or -1 when the file has the wrong shape.
function checkArtists(path, value, errors) {
  if (!Array.isArray(value) || !value.every(isText)) {
    errors.push(`${path}: expected an array of artist names`);
    return -1;
  }
  return value.length;
}

function checkNested(path, value, errors, withSongs) {
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
      const ok = Array.isArray(album) && isText(album[0]) && isYear(album[1])
        && (withSongs ? album.length === 3 && Array.isArray(album[2]) && album[2].every(isText) : album.length === 2);
      if (!ok) {
        const shape = withSongs ? '["Album", year, ["Song", …]]' : '["Album", year]';
        errors.push(`${path}: ${name} has an album that is not ${shape}: ${JSON.stringify(album).slice(0, 60)}`);
        return -1;
      }
      count += withSongs ? album[2].length : 1;
    }
  }
  return count;
}

export async function checkData(dir = 'data') {
  const errors = [];
  const index = await readJson(dir, 'index.json', errors);
  if (!index) return { ok: false, errors };
  if (!Array.isArray(index.genres) || index.genres.length === 0) {
    errors.push('index.json: expected a non-empty "genres" array');
    return { ok: false, errors };
  }
  for (const genre of index.genres) {
    if (!isText(genre.slug) || !isText(genre.name)) {
      errors.push(`index.json: genre ${JSON.stringify(genre).slice(0, 60)} needs "slug" and "name"`);
      continue;
    }
    const found = {
      artists: checkArtists(`artists/${genre.slug}.json`, await readJson(dir, `artists/${genre.slug}.json`, errors), errors),
      albums: checkNested(`albums/${genre.slug}.json`, await readJson(dir, `albums/${genre.slug}.json`, errors), errors, false),
      songs: checkNested(`songs/${genre.slug}.json`, await readJson(dir, `songs/${genre.slug}.json`, errors), errors, true),
    };
    for (const [type, n] of Object.entries(found)) {
      if (n < 0) continue;
      if (n < 2) errors.push(`${type}/${genre.slug}.json: needs at least 2 items for a question, has ${n}`);
      const claimed = genre.counts && genre.counts[type];
      if (claimed !== undefined && claimed !== n) errors.push(`index.json: ${genre.slug} counts.${type} is ${claimed} but the file has ${n}`);
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
