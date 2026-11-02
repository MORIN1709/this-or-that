// One-time build of the static music data in data/.
//
//   node tools/build-data.mjs                      # all genres
//   node tools/build-data.mjs --genres "thrash metal,grunge"
//
// Files: artists/<genre>.json, albums/<genre>.json, songs/<artist>.json (shared by all genres).
// For each genre: the 30 most-listened artists (MusicBrainz tag search, ranked by ListenBrainz),
// all their studio albums, and every song on those albums. Polite: <= 1 request per 1.1s,
// identified by User-Agent, cached in .cache/http so an interrupted run resumes.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFetcher } from './fetcher.mjs';
import { GENRES, slugify, pickArtists, studioAlbums, genreFiles, songList, artistKey } from './build-lib.mjs';

const MB = 'https://musicbrainz.org/ws/2';
const LB_POPULARITY = 'https://api.listenbrainz.org/1/popularity/artist';
export const USER_AGENT = 'this-or-that/1.0 ( https://github.com/MORIN1709/this-or-that )';

const searchUrl = (genre) => `${MB}/artist?${new URLSearchParams({
  fmt: 'json', limit: '100', query: `tag:"${genre}" AND (type:group OR type:person) AND NOT country:IL`,
})}`;
const releasesUrl = (artistId, offset) => `${MB}/release?${new URLSearchParams({
  fmt: 'json', artist: artistId, status: 'official', type: 'album', inc: 'recordings+release-groups', limit: '100', offset: String(offset),
})}`;

// All official album releases of an artist. The API returns fewer than `limit` per page when
// recordings are included, so the offset advances by what actually came back.
async function fetchReleases(fetcher, artistId, log) {
  const releases = [];
  let offset = 0;
  for (let page = 1; ; page++) {
    const body = await fetcher.getJson(releasesUrl(artistId, offset));
    const batch = (body && body.releases) || [];
    releases.push(...batch);
    offset += batch.length;
    log(`    page ${page}: ${offset}/${body?.['release-count'] ?? '?'} releases`);
    if (batch.length === 0 || offset >= (body['release-count'] ?? 0)) return releases;
  }
}

export async function buildAll({
  fetcher, genres = GENRES, perGenre = 30, minArtists = 5,
  built = new Date().toISOString().slice(0, 10), log = () => {},
}) {
  const albumsByArtist = new Map(); // artists shared between genres are fetched once
  const keyByArtist = new Map();    // …and get one songs file
  const usedKeys = new Set();
  const files = new Map();
  const index = { built, genres: [] };

  for (const genre of genres) {
    log(`genre: ${genre}`);
    const search = await fetcher.getJson(searchUrl(genre));
    const candidates = (search && search.artists) || [];
    const rows = candidates.length ? await fetcher.postJson(LB_POPULARITY, { artist_mbids: candidates.map((a) => a.id) }) : [];
    const scores = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.artist_mbid, r.total_user_count || 0]));
    const picked = pickArtists(candidates, scores, genre, perGenre);
    if (picked.length < minArtists) {
      log(`  skipped: only ${picked.length} artists after filtering`);
      continue;
    }

    const entries = [];
    for (const a of picked) {
      if (!albumsByArtist.has(a.id)) {
        log(`  artist: ${a.name}`);
        albumsByArtist.set(a.id, studioAlbums(await fetchReleases(fetcher, a.id, log)));
      }
      if (!keyByArtist.has(a.id)) {
        const key = artistKey(a, usedKeys);
        keyByArtist.set(a.id, key);
        files.set(`songs/${key}.json`, songList(albumsByArtist.get(a.id)));
      }
      entries.push({ name: a.name, key: keyByArtist.get(a.id), albums: albumsByArtist.get(a.id) });
    }

    const slug = slugify(genre);
    const shaped = genreFiles(entries);
    files.set(`artists/${slug}.json`, shaped.artists);
    files.set(`albums/${slug}.json`, shaped.albums);
    const albums = entries.reduce((n, e) => n + e.albums.length, 0);
    const songs = entries.reduce((n, e) => n + songList(e.albums).length, 0);
    index.genres.push({ slug, name: genre, counts: { artists: entries.length, albums, songs } });
  }
  return { index, files };
}

// Writes the files compactly. index.json is merged with what is already on disk, so building a
// subset of genres doesn't drop the others.
export async function writeData(dir, { index, files }) {
  for (const [path, value] of files) {
    const file = join(dir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  }
  let previous = [];
  try {
    previous = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')).genres || [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const bySlug = new Map(previous.map((g) => [g.slug, g]));
  for (const g of index.genres) bySlug.set(g.slug, g);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.json'), JSON.stringify({ ...index, genres: [...bySlug.values()] }, null, 1));
}

async function main() {
  const arg = process.argv.indexOf('--genres');
  const genres = arg > -1 ? process.argv[arg + 1].split(',').map((g) => g.trim()) : GENRES;
  const fetcher = createFetcher({ cacheDir: '.cache/http', userAgent: USER_AGENT });
  const result = await buildAll({ fetcher, genres, log: (line) => console.log(line) });
  await writeData('data', result);
  console.log('\nsummary:');
  for (const g of result.index.genres) console.log(`  ${g.name}: ${g.counts.artists} artists, ${g.counts.albums} albums, ${g.counts.songs} songs`);
  console.log(`requests: ${fetcher.stats.network} network, ${fetcher.stats.cached} from cache`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
