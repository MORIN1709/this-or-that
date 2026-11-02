const MB_BASE = 'https://musicbrainz.org/ws/2';
const LB_BASE = 'https://api.listenbrainz.org/1/popularity';
const LB_MAX_IDS = 1000;

export class ApiError extends Error {
  constructor(service, status) {
    super(`${service} answered HTTP ${status}`);
    this.name = 'ApiError';
    this.service = service;
    this.status = status;
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The timeout covers the whole exchange, body included: a body that stalls mid-download
// must not hold the MusicBrainz queue forever. Resolves { ok, status, body? }.
async function fetchJson(fetchImpl, url, init, timeoutMs, service) {
  const ctrl = new AbortController();
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => { ctrl.abort(); reject(new Error(`${service} timed out`)); }, timeoutMs);
  });
  timedOut.catch(() => {});
  try {
    const res = await Promise.race([fetchImpl(url, { ...init, signal: ctrl.signal }), timedOut]);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, body: await Promise.race([res.json(), timedOut]) };
  } finally {
    clearTimeout(timer);
  }
}

// All MusicBrainz requests go through one queue: ~1 request per second per IP.
export function createMbClient({
  fetchImpl = (...a) => fetch(...a), sleep = defaultSleep, now = Date.now,
  minIntervalMs = 1050, maxAttempts = 4, timeoutMs = 15000,
} = {}) {
  let lastCall = -Infinity;
  let chain = Promise.resolve();

  async function run(url) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const wait = lastCall + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastCall = now();
      const res = await fetchJson(fetchImpl, url, { headers: { Accept: 'application/json' } }, timeoutMs, 'MusicBrainz');
      if (res.ok) return res.body;
      const retryable = res.status === 503 || res.status === 429;
      if (!retryable || attempt === maxAttempts - 1) throw new ApiError('musicbrainz', res.status);
      await sleep(2000 * (attempt + 1));
    }
  }

  function get(path, params = {}) {
    const qs = new URLSearchParams({ fmt: 'json' });
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    const url = `${MB_BASE}${path}?${qs}`;
    const p = chain.then(() => run(url));
    chain = p.catch(() => {});
    return p;
  }

  return { get };
}

// ListenBrainz batch popularity: no token needed (unlike the top-*-for-artist endpoints).
export function createLbClient({ fetchImpl = (...a) => fetch(...a), timeoutMs = 15000 } = {}) {
  async function popularity(entity, mbids) {
    const scores = new Map();
    const ids = mbids.slice(0, LB_MAX_IDS);
    if (ids.length === 0) return scores;
    const key = entity.replace('-', '_');
    const res = await fetchJson(fetchImpl, `${LB_BASE}/${entity}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [`${key}_mbids`]: ids }),
    }, timeoutMs, 'ListenBrainz');
    if (!res.ok) throw new ApiError('listenbrainz', res.status);
    const rows = res.body;
    if (!Array.isArray(rows)) {
      console.warn(`ListenBrainz /${entity}: expected an array, got keys:`, Object.keys(rows || {}).join(', '));
      return scores;
    }
    for (const row of rows) {
      const id = row && row[`${key}_mbid`];
      if (id) scores.set(id, Number(row.total_user_count) || 0);
    }
    return scores;
  }
  return { popularity };
}
