import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkData } from '../tools/check-data.mjs';

const SAMPLE = fileURLToPath(new URL('./fixtures/data', import.meta.url));

async function copyOfSample() {
  const dir = await mkdtemp(join(tmpdir(), 'data-'));
  await cp(SAMPLE, dir, { recursive: true });
  return dir;
}
const edit = async (dir, path, fn) => writeFile(join(dir, path), JSON.stringify(fn(JSON.parse(await readFile(join(dir, path), 'utf8')))));

test('the sample data passes', async () => {
  assert.deepEqual(await checkData(SAMPLE), { ok: true, errors: [] });
});

test('reports a missing index', async () => {
  const dir = await copyOfSample();
  await rm(join(dir, 'index.json'));
  const r = await checkData(dir);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /index\.json/);
});

test('reports a missing genre file', async () => {
  const dir = await copyOfSample();
  await rm(join(dir, 'songs/nirvana.json'));
  const r = await checkData(dir);
  assert.ok(r.errors.some((e) => e.includes('songs/nirvana.json')), r.errors.join('\n'));
});

test('reports a wrongly shaped album entry', async () => {
  const dir = await copyOfSample();
  await edit(dir, 'albums/thrash-metal.json', (a) => { a[0][1][0] = ['Kill ’Em All', 1983]; return a; });
  const r = await checkData(dir);
  assert.ok(r.errors.some((e) => e.includes('albums/thrash-metal.json') && e.includes('Metallica')), r.errors.join('\n'));
});

test('reports a song list that is not an array of strings', async () => {
  const dir = await copyOfSample();
  await edit(dir, 'songs/nirvana.json', () => [['rg-1', 'Blew']]);
  const r = await checkData(dir);
  assert.ok(r.errors.some((e) => e.includes('songs/nirvana.json')), r.errors.join('\n'));
});

test('reports counts that do not match the files', async () => {
  const dir = await copyOfSample();
  await edit(dir, 'index.json', (i) => { i.genres[0].counts.songs = 999; return i; });
  const r = await checkData(dir);
  assert.ok(r.errors.some((e) => e.includes('thrash-metal') && e.includes('songs') && e.includes('999')), r.errors.join('\n'));
});

test('reports a genre with fewer than 2 items of a type', async () => {
  const dir = await copyOfSample();
  await edit(dir, 'artists/grunge.json', () => [['Nirvana', 'nirvana', 'https://img.test/n.jpg']]);
  await edit(dir, 'index.json', (i) => { i.genres[1].counts.artists = 1; return i; });
  const r = await checkData(dir);
  assert.ok(r.errors.some((e) => e.includes('artists/grunge.json') && e.includes('at least 2')), r.errors.join('\n'));
});

test('reports an artist entry without a songs file key', async () => {
  const dir = await copyOfSample();
  await edit(dir, 'artists/grunge.json', (a) => { a[0] = ['Nirvana']; return a; });
  const r = await checkData(dir);
  assert.ok(r.errors.some((e) => e.includes('artists/grunge.json')), r.errors.join('\n'));
});

test('reports an artist without a photo', async () => {
  const dir = await copyOfSample();
  await edit(dir, 'artists/grunge.json', (a) => { a[1][2] = ''; return a; });
  const r = await checkData(dir);
  assert.ok(r.errors.some((e) => e.includes('artists/grunge.json') && e.includes('Pearl Jam') && e.includes('photo')), r.errors.join('\n'));
});
