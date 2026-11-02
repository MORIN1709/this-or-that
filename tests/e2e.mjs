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
  await page.waitForTimeout(2000); // let Q2 and Q3 arrive so Q1→Q2 is instant
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

await check('skip moves to another question without choosing', async () => {
  const page = await openPage();
  await waitForQuestion(page);
  await page.waitForTimeout(2000); // let the next questions arrive
  const before = await pairText(page);
  await page.getByRole('button', { name: 'עבור' }).click();
  const after = await page.$$eval('button.option', (bs) => ({ chosen: bs.filter((b) => b.classList.contains('chosen')).length, disabled: bs.every((b) => b.disabled) }));
  assert(after.chosen === 0, 'skip must not mark an option as chosen');
  assert(after.disabled, 'options are disabled while skipping');
  await page.waitForFunction((b) => [...document.querySelectorAll('button.option .title')].map((e) => e.textContent).join(' || ') !== b, before, { timeout: T });
  await waitForQuestion(page);
  await page.close();
});

await check('double click on skip skips once', async () => {
  const page = await openPage();
  await waitForQuestion(page);
  await page.waitForTimeout(2000);
  const q0 = await pairText(page);
  await page.getByRole('button', { name: 'עבור' }).dblclick();
  await page.waitForFunction((b) => [...document.querySelectorAll('button.option .title')].map((e) => e.textContent).join(' || ') !== b, q0, { timeout: T });
  await waitForQuestion(page);
  const q1 = await pairText(page);
  await page.waitForTimeout(1500);
  assert((await pairText(page)) === q1, 'a second question was skipped by the double click');
  await page.close();
});

await check('no data credit line on the page', async () => {
  const page = await openPage();
  await waitForQuestion(page);
  const text = await page.evaluate(() => document.body.innerText);
  assert(!/MusicBrainz|ListenBrainz/.test(text), 'credit line still shown');
  await page.close();
});

await check('every option shows its picture', async () => {
  const page = await openPage();
  await waitForQuestion(page);
  await page.waitForFunction(() => [...document.querySelectorAll('button.option img')].every((i) => i.complete && i.naturalWidth > 0 && i.offsetParent !== null), null, { timeout: T });
  const srcs = await page.$$eval('button.option img', (imgs) => imgs.map((i) => i.getAttribute('src')));
  assert(srcs.length === 2 && srcs.every((s) => /^https:/.test(s)), `srcs: ${srcs}`);
  await page.close();
});

await check('a picture that fails to load shows the first letter instead', async () => {
  imageMode = 'broken';
  const page = await openPage();
  await waitForQuestion(page);
  await page.waitForFunction(() => [...document.querySelectorAll('button.option')].every((b) => b.classList.contains('no-image')), null, { timeout: T });
  const shown = await page.$$eval('button.option', (bs) => bs.map((b) => ({
    letter: b.querySelector('.initial').textContent,
    first: b.querySelector('.title').textContent.trim().charAt(0).toUpperCase(),
    letterVisible: b.querySelector('.initial').offsetParent !== null,
    imgVisible: b.querySelector('img').offsetParent !== null,
  })));
  assert(shown.every((x) => x.letter === x.first && x.letterVisible && !x.imgVisible), JSON.stringify(shown));
  await page.close();
});

await check('pictures of the next questions are loaded ahead', async () => {
  imageRequests.length = 0;
  const page = await openPage();
  await waitForQuestion(page);
  await page.waitForTimeout(2000);
  assert(new Set(imageRequests).size >= 4, `only ${new Set(imageRequests).size} image requests before answering`);
  await page.close();
});

await check('never contacts MusicBrainz or ListenBrainz', async () => {
  externalRequests.length = 0;
  const page = await openPage();
  for (let i = 0; i < 5; i++) {
    await waitForQuestion(page);
    const before = await pairText(page);
    await page.click('button.option >> nth=0');
    await page.waitForFunction((b) => [...document.querySelectorAll('button.option .title')].map((e) => e.textContent).join(' || ') !== b, before, { timeout: T });
  }
  assert(externalRequests.length === 0, `external requests: ${externalRequests.join(', ')}`);
  await page.close();
});

await browser.close();
server.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`# pass ${results.length - failed}\n# fail ${failed}`);
process.exit(failed ? 1 : 0);
