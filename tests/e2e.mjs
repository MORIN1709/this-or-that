// End-to-end check in a real Chromium, with MusicBrainz and ListenBrainz served from fixtures.
// Run: npm run e2e
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIX = (name) => JSON.parse(readFileSync(join(ROOT, 'tests/fixtures', name), 'utf8'));
const LABELS = ['איזו להקה או אמן?', 'איזה אלבום?', 'איזה שיר?'];
const LOADING = 'מביאים שאלה…';
const ERROR = 'לא הצלחנו להביא שאלה. בדקו את החיבור ונסו שוב.';
const T = 30000;

// ---- static server for the site ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}/`;

// ---- fake APIs ----
let mode = 'ok'; // 'ok' | 'fail' | 'slow'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function musicbrainz(url) {
  const path = url.pathname.replace(/^\/ws\/2/, '');
  if (path === '/artist') return FIX('mb-artists.json');
  if (path === '/release-group') return FIX('mb-release-groups.json');
  const rg = path.match(/^\/release-group\/(.+)$/);
  if (rg) { // releases specific to this album, so each album gets its own songs
    const body = FIX('mb-release-group-releases.json');
    body.releases = body.releases.map((r) => ({ ...r, id: `${r.id}-${rg[1]}` }));
    return body;
  }
  const rel = path.match(/^\/release\/(.+)$/);
  if (rel) {
    const body = FIX('mb-release.json');
    for (const m of body.media) for (const t of m.tracks) t.recording.id = `${t.recording.id}-${rel[1]}`;
    return body;
  }
  return null;
}

function listenbrainz(url, request) {
  const entity = url.pathname.split('/').pop().replace('-', '_');
  const ids = request.postDataJSON()[`${entity}_mbids`] || [];
  return ids.map((id, i) => ({ [`${entity}_mbid`]: id, total_listen_count: 5000 - i, total_user_count: 1000 - i }));
}

async function handle(route) {
  const request = route.request();
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  if (mode === 'slow') await sleep(3000);
  if (mode === 'fail') return route.fulfill({ status: 500, headers: CORS, body: 'down' });
  const url = new URL(request.url());
  const body = url.hostname === 'musicbrainz.org' ? musicbrainz(url) : listenbrainz(url, request);
  if (body === null) return route.fulfill({ status: 404, headers: CORS, body: 'unknown fixture' });
  return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// ---- helpers ----
const browser = await chromium.launch();
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  await page.route('https://musicbrainz.org/**', handle);
  await page.route('https://api.listenbrainz.org/**', handle);
  await page.goto(SITE);
  return page;
}
const waitForQuestion = (page) => page.waitForFunction((labels) => {
  const label = document.getElementById('question-label')?.textContent;
  const opts = [...document.querySelectorAll('button.option')];
  return labels.includes(label) && opts.length === 2
    && opts.every((b) => !b.disabled && b.offsetParent !== null && b.querySelector('.title').textContent.trim());
}, LABELS, { timeout: T });
const pairText = (page) => page.$$eval('button.option .title', (els) => els.map((e) => e.textContent).join(' || '));

const results = [];
async function check(name, fn) {
  mode = 'ok';
  try { await fn(); results.push([name, true]); console.log(`ok - ${name}`); }
  catch (e) { results.push([name, false]); console.log(`not ok - ${name}\n  ${e.message.split('\n')[0]}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---- checks ----
await check('loads first question', async () => {
  const page = await openPage();
  await waitForQuestion(page);
  await page.close();
});

await check('choice advances and disables', async () => {
  const page = await openPage();
  await waitForQuestion(page);
  const before = await pairText(page);
  await page.click('button.option >> nth=0');
  const disabled = await page.$$eval('button.option', (bs) => bs.every((b) => b.disabled));
  assert(disabled, 'both options should be disabled right after a choice');
  await page.waitForFunction((b) => [...document.querySelectorAll('button.option .title')].map((e) => e.textContent).join(' || ') !== b, before, { timeout: T });
  await waitForQuestion(page);
  await page.close();
});

await check('double click registers once', async () => {
  const page = await openPage();
  await waitForQuestion(page);
  await page.waitForTimeout(8000); // let Q2 and Q3 arrive so Q1→Q2 is instant
  const q0 = await pairText(page);
  await page.dblclick('button.option >> nth=1');
  await page.waitForFunction((b) => [...document.querySelectorAll('button.option .title')].map((e) => e.textContent).join(' || ') !== b, q0, { timeout: T });
  await waitForQuestion(page);
  const q1 = await pairText(page);
  await page.waitForTimeout(1500);
  assert((await pairText(page)) === q1, 'a second question was consumed by the double click');
  await page.close();
});

await check('reset loads a question', async () => {
  const page = await openPage();
  await waitForQuestion(page);
  await page.click('#reset');
  await waitForQuestion(page);
  await page.close();
});

await check('error then retry', async () => {
  mode = 'fail';
  const page = await openPage();
  await page.getByText(ERROR).waitFor({ state: 'visible', timeout: T });
  assert(await page.getByRole('button', { name: 'נסה שוב' }).isVisible(), 'retry button visible');
  mode = 'ok';
  await page.getByRole('button', { name: 'נסה שוב' }).click();
  await waitForQuestion(page);
  await page.close();
});

await check('no horizontal scroll with long names', async () => {
  const page = await openPage();
  await waitForQuestion(page);
  await page.$$eval('button.option .title', (els) => {
    els[0].textContent = 'A Very Long Album Title That Keeps Going and Going Past Any Reasonable Width';
    els[1].textContent = 'TheExtraordinarilyLongNamedThrashCollectiveOfTheNorthernValleyRegionWithoutSpaces';
  });
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert(fits, 'page scrolls horizontally');
  await page.close();
});

await check('option text is dir=auto', async () => {
  const page = await openPage();
  await waitForQuestion(page);
  const dirs = await page.$$eval('button.option .title, button.option .meta', (els) => els.map((e) => e.getAttribute('dir')));
  assert(dirs.length === 4 && dirs.every((d) => d === 'auto'), `dirs: ${dirs}`);
  await page.close();
});

await check('slow network shows loading', async () => {
  mode = 'slow';
  const page = await openPage();
  await page.getByText(LOADING).waitFor({ state: 'visible', timeout: T });
  await waitForQuestion(page);
  await page.close();
});

await browser.close();
server.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`# pass ${results.length - failed}\n# fail ${failed}`);
process.exit(failed ? 1 : 0);
