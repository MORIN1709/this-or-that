// End-to-end check in a real Chromium; data/ is served from the sample in tests/fixtures/data.
// Run: npm run e2e
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LABELS = ['איזו להקה או אמן?', 'איזה אלבום?'];
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

// ---- data/ is served from the sample in tests/fixtures/data ----
let mode = 'ok'; // 'ok' | 'fail' | 'slow'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// E2E_DATA=data runs against the real data instead of the sample.
const SAMPLE = join(ROOT, process.env.E2E_DATA || 'tests/fixtures/data');
const externalRequests = [];
let imageMode = 'ok'; // 'ok' | 'broken'
const imageRequests = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function serveImage(route) {
  imageRequests.push(route.request().url());
  if (imageMode === 'broken') return route.fulfill({ status: 404, body: 'no image' });
  return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
}

async function serveData(route) {
  if (mode === 'slow') await sleep(3000);
  if (mode === 'fail') return route.fulfill({ status: 500, body: 'down' });
  const rel = new URL(route.request().url()).pathname.replace(/^\/data\//, '');
  const file = join(SAMPLE, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ status: 200, contentType: 'application/json', body: readFileSync(file) });
}

// ---- helpers ----
const browser = await chromium.launch();
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  page.on('request', (r) => { if (/musicbrainz\.org|listenbrainz\.org/.test(r.url())) externalRequests.push(r.url()); });
  await page.route(`${SITE}data/**`, serveData);
  await page.route(/img\.test|coverartarchive\.org|wikimedia\.org|dzcdn\.net|theaudiodb\.com/, serveImage);
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
  imageMode = 'ok';
  try { await fn(); results.push([name, true]); console.log(`ok - ${name}`); }
  catch (e) { results.push([name, false]); console.log(`not ok - ${name}\n  ${e.message.split('\n')[0]}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---- checks ----
const startGame = async (page, mode) => {
  await page.getByRole('button', { name: mode, exact: true }).click();
  await waitForQuestion(page);
};
const titles = (page) => page.$$eval('button.option .title', (els) => els.map((e) => e.textContent));
const waitTitlesChange = (page, before) => page.waitForFunction((b) => {
  const now = [...document.querySelectorAll('button.option .title')].map((e) => e.textContent).join(' || ');
  return document.body.dataset.state === 'end' || (document.body.dataset.state === 'question' && now !== b);
}, before.join(' || '), { timeout: T });

await check('the page declares a real icon, so the browser does not ask for /favicon.ico', async () => {
  const page = await openPage();
  const icon = await page.getAttribute('link[rel="icon"]', 'href');
  assert(icon && icon.startsWith('data:image/svg+xml,') && icon.length > 40, `icon: ${icon}`);
  assert((await page.title()).includes('זה או זה'), 'page title');
  await page.close();
});

await check('start screen offers albums and artists only, no question yet', async () => {
  const page = await openPage();
  await page.getByRole('button', { name: 'אלבומים', exact: true }).waitFor({ state: 'visible', timeout: T });
  assert(await page.getByRole('button', { name: 'אמנים', exact: true }).isVisible(), 'artists button');
  const modes = await page.$$eval('.modes button', (bs) => bs.map((b) => b.textContent.trim()));
  assert(JSON.stringify(modes) === JSON.stringify(['אלבומים', 'אמנים']), `modes: ${modes}`);
  assert(!(await page.locator('.board').isVisible()), 'no question on the start screen');
  assert(!(await page.evaluate(() => document.body.innerText.includes('שיר'))), 'songs are mentioned');
  await page.close();
});

await check('choosing artists starts an artist game', async () => {
  const page = await openPage();
  await startGame(page, 'אמנים');
  assert((await page.textContent('#question-label')) === 'איזו להקה או אמן?', 'artist label');
  assert((await page.textContent('#genre')).trim() !== '', 'genre shown');
  await page.close();
});

await check('choosing albums starts an album game', async () => {
  const page = await openPage();
  await startGame(page, 'אלבומים');
  assert((await page.textContent('#question-label')) === 'איזה אלבום?', 'album label');
  const metas = await page.$$eval('button.option .meta', (els) => els.map((e) => e.textContent));
  assert(metas.every((m) => /\d{4}/.test(m)), `album meta: ${metas}`);
  await page.close();
});

await check('the chosen one stays as king and a new challenger replaces the other', async () => {
  const page = await openPage();
  await startGame(page, 'אמנים');
  const before = await titles(page);
  await page.click('button.option >> nth=1');
  await waitTitlesChange(page, before);
  const after = await titles(page);
  assert(after[1] === before[1], `king moved: ${before} -> ${after}`);
  assert(after[0] !== before[0] && after[0] !== before[1], `challenger: ${before} -> ${after}`);
  const kings = await page.$$eval('button.option', (bs) => bs.map((b) => b.classList.contains('king') && b.querySelector('.crown').offsetParent !== null));
  assert(JSON.stringify(kings) === '[false,true]', `crowns: ${kings}`);
  await page.close();
});

await check('skip replaces only the challenger', async () => {
  const page = await openPage();
  await startGame(page, 'אמנים');
  let before = await titles(page);
  await page.click('button.option >> nth=0');
  await waitTitlesChange(page, before);
  before = await titles(page);
  await page.getByRole('button', { name: 'עבור' }).click();
  await waitTitlesChange(page, before);
  const after = await titles(page);
  assert(after[0] === before[0] && after[1] !== before[1], `${before} -> ${after}`);
  await page.close();
});

await check('skip before any choice replaces both', async () => {
  const page = await openPage();
  await startGame(page, 'אמנים');
  const before = await titles(page);
  await page.getByRole('button', { name: 'עבור' }).click();
  await waitTitlesChange(page, before);
  const after = await titles(page);
  assert(after.every((t) => !before.includes(t)), `${before} -> ${after}`);
  await page.close();
});

await check('double click registers once', async () => {
  const page = await openPage();
  await startGame(page, 'אלבומים');
  const before = await titles(page);
  await page.dblclick('button.option >> nth=0');
  await waitTitlesChange(page, before);
  const once = await titles(page);
  await page.waitForTimeout(1500);
  assert(JSON.stringify(await titles(page)) === JSON.stringify(once), 'a second challenger was consumed');
  await page.close();
});

await check('reset returns to the start screen', async () => {
  const page = await openPage();
  await startGame(page, 'אמנים');
  await page.getByRole('button', { name: 'ערבוב מחדש' }).click();
  await page.getByRole('button', { name: 'אמנים', exact: true }).waitFor({ state: 'visible', timeout: T });
  assert(!(await page.locator('.board').isVisible()), 'board still visible');
  await page.close();
});

await check('a full game ends with the king, and a new game starts over', async () => {
  const page = await openPage();
  await startGame(page, 'אמנים');
  const genre = (await page.textContent('#genre')).trim();
  let king = null;
  for (let i = 0; i < 200; i++) {
    const state = await page.evaluate(() => document.body.dataset.state);
    if (state === 'end') break;
    const before = await titles(page);
    const side = await page.$$eval('button.option', (bs) => Math.max(0, bs.findIndex((b) => b.classList.contains('king'))));
    king = before[side];
    await page.click(`button.option >> nth=${side}`);
    await waitTitlesChange(page, before);
  }
  await page.locator('.end').waitFor({ state: 'visible', timeout: T });
  assert((await page.textContent('#end-genre')).trim() === genre, 'genre on the end screen');
  assert((await page.textContent('.end .title')).trim() === king, `winner should be ${king}`);
  assert(await page.locator('.end img').isVisible(), 'winner picture');
  await page.getByRole('button', { name: 'משחק חדש' }).click();
  await page.getByRole('button', { name: 'אלבומים', exact: true }).waitFor({ state: 'visible', timeout: T });
  await page.close();
});

await check('pictures are 200x200', async () => {
  const page = await openPage();
  await startGame(page, 'אמנים');
  const sizes = await page.$$eval('button.option .thumb', (ts) => ts.map((t) => [t.getBoundingClientRect().width, t.getBoundingClientRect().height]));
  assert(sizes.every(([w, h]) => w === 200 && h === 200), `sizes: ${JSON.stringify(sizes)}`);
  await page.close();
});

await check('every option shows its picture', async () => {
  const page = await openPage();
  await startGame(page, 'אלבומים');
  await page.waitForFunction(() => [...document.querySelectorAll('button.option img')].every((i) => i.complete && i.naturalWidth > 0 && i.offsetParent !== null), null, { timeout: T });
  await page.close();
});

await check('a picture that fails to load shows the first letter instead', async () => {
  imageMode = 'broken';
  const page = await openPage();
  await startGame(page, 'אמנים');
  await page.waitForFunction(() => [...document.querySelectorAll('button.option')].every((b) => b.classList.contains('no-image')), null, { timeout: T });
  const shown = await page.$$eval('button.option', (bs) => bs.map((b) => ({
    letter: b.querySelector('.initial').textContent,
    first: b.querySelector('.title').textContent.trim().charAt(0).toUpperCase(),
    visible: b.querySelector('.initial').offsetParent !== null,
  })));
  assert(shown.every((x) => x.letter === x.first && x.visible), JSON.stringify(shown));
  await page.close();
});

await check('pictures of the next challengers are loaded ahead', async () => {
  imageRequests.length = 0;
  const page = await openPage();
  await startGame(page, 'אמנים');
  await page.waitForTimeout(1500);
  assert(new Set(imageRequests).size >= 4, `only ${new Set(imageRequests).size} pictures requested`);
  await page.close();
});

await check('error then retry', async () => {
  mode = 'fail';
  const page = await openPage();
  await page.getByRole('button', { name: 'אמנים', exact: true }).click();
  await page.getByText(ERROR).waitFor({ state: 'visible', timeout: T });
  mode = 'ok';
  await page.getByRole('button', { name: 'נסה שוב' }).click();
  await waitForQuestion(page);
  await page.close();
});

await check('slow network shows loading', async () => {
  mode = 'slow';
  const page = await openPage();
  await page.getByRole('button', { name: 'אמנים', exact: true }).click();
  await page.getByText(LOADING).waitFor({ state: 'visible', timeout: T });
  await waitForQuestion(page);
  await page.close();
});

await check('no horizontal scroll with long names', async () => {
  const page = await openPage();
  await startGame(page, 'אלבומים');
  await page.$$eval('button.option .title', (els) => {
    els[0].textContent = 'A Very Long Album Title That Keeps Going and Going Past Any Reasonable Width';
    els[1].textContent = 'TheExtraordinarilyLongNamedThrashCollectiveOfTheNorthernValleyRegionWithoutSpaces';
  });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'page scrolls horizontally');
  await page.close();
});

await check('option text is dir=auto', async () => {
  const page = await openPage();
  await startGame(page, 'אלבומים');
  const dirs = await page.$$eval('button.option .title, button.option .meta', (els) => els.map((e) => e.getAttribute('dir')));
  assert(dirs.length === 4 && dirs.every((d) => d === 'auto'), `dirs: ${dirs}`);
  await page.close();
});

await check('never contacts MusicBrainz or ListenBrainz', async () => {
  externalRequests.length = 0;
  const page = await openPage();
  await startGame(page, 'אמנים');
  for (let i = 0; i < 3; i++) {
    const before = await titles(page);
    await page.click('button.option >> nth=0');
    await waitTitlesChange(page, before);
  }
  assert(externalRequests.length === 0, `external requests: ${externalRequests.join(', ')}`);
  await page.close();
});

await browser.close();
server.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`# pass ${results.length - failed}\n# fail ${failed}`);
process.exit(failed ? 1 : 0);
