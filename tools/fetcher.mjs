// Polite, cached HTTP for the one-time data build.
// - one request at a time, at most one per `minIntervalMs` (MusicBrainz asks for <= 1/s)
// - identifies itself with a User-Agent, as MusicBrainz requires
// - every successful answer is cached on disk, so an interrupted build resumes without re-fetching
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createFetcher({
  cacheDir, userAgent,
  fetchImpl = (...a) => fetch(...a),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  minIntervalMs = 1100, maxAttempts = 5, timeoutMs = 60000,
}) {
  const stats = { network: 0, cached: 0 };
  let lastCall = -Infinity;
  let chain = Promise.resolve();

  async function cached(key, load) {
    const file = join(cacheDir, `${createHash('sha1').update(key).digest('hex')}.json`);
    try {
      const value = JSON.parse(await readFile(file, 'utf8'));
      stats.cached += 1;
      return value;
    } catch (err) {
      if (err instanceof SyntaxError) console.warn(`Corrupt cache file, fetching again: ${file}`);
      else if (err.code !== 'ENOENT') throw err;
    }
    const value = await load();
    await mkdir(cacheDir, { recursive: true });
    // Write then rename: a build killed mid-write never leaves a half-written cache file behind.
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(value));
    await rename(temp, file);
    return value;
  }

  function queued(fn) {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  }

  async function request(url, init) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const wait = lastCall + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastCall = now();
      stats.network += 1;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(url, {
          ...init,
          signal: ctrl.signal,
          headers: { 'User-Agent': userAgent, Accept: 'application/json', ...(init.headers || {}) },
        });
        if (res.ok) return await res.json();
      } catch (err) {
        // Dropped connection or timeout (seen in practice: ECONNRESET mid-build): wait and retry.
        if (attempt === maxAttempts) throw err;
        res = null;
      } finally {
        clearTimeout(timer);
      }
      if (res) {
        const retryable = res.status === 503 || res.status === 429;
        if (!retryable || attempt === maxAttempts) throw new Error(`HTTP ${res.status} for ${url}`);
      }
      await sleep(2000 * attempt);
    }
  }

  return {
    stats,
    getJson: (url) => cached(url, () => queued(() => request(url, {}))),
    postJson: (url, body) => cached(url + JSON.stringify(body), () => queued(() => request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))),
  };
}
