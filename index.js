// IPTV Live TV (English) - Stremio addon. No dependencies (Node 18+ for global fetch).
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 7000;
const PAGE = 100;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_FAIL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_TRIES = 3;
const CACHE_FILE = process.env.CACHE_FILE || path.join(__dirname, 'cache.json');
const API = process.env.IPTV_API || 'https://iptv-org.github.io/api/';
const FREETV = process.env.FREETV_URL || 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8';

const EN_COUNTRIES = ['US', 'GB', 'UK', 'CA', 'AU', 'NZ', 'IE'];
const FREETV_GROUPS = ['UK', 'USA', 'Canada', 'Australia', 'New Zealand', 'Ireland', 'VOD Movies (EN)'];
const FREETV_MIXED = ['News', 'Business', 'Weather']; // kept only if tvg-country is English-speaking

// Word/phrase blocklist for leftover non-English channels wrongly tagged eng.
// Intentionally specific: do NOT match France 24, DW/Deutsche Welle English, BBC, CBC, etc.
const NON_EN_NAME = new RegExp([
  'deportes', 'polska', 'pamir', '\\bder\\s*tv\\b',
  'telemundo', 'univision', 'unimas', 'galavisi[oó]n', 'televisa', 'azteca',
  'espa[nñ]ol', 'espanol', 'españa', '\\blatino\\b', 'latin\\s*pop', 'latin\\s*america',
  'en\\s*vivo', 'telenovela', 'novelas?',
  'noticias', 'notizie', 'nachrichten',
  '\\bdeutsch(?:e|er|en)?\\b', 'fran[cç]ais',
  'portugu[eê]s', '\\bbrasil\\b', 'tv\\s*globo', '\\bsbt\\b',
  'italiano', '\\brai\\s*italia\\b', '\\brai\\s*[123]\\b',
  'arabic', 'عربي', 'hindi', 'urdu', 'turkish', 't[uü]rk(?:çe|ce)\\b',
  'russian', 'russkiy', 'russkaya', '한국어', 'hanguk',
  'm[uú]sica(?!l)',
  '\\bpolsat\\b', '\\btvp\\s*[123]\\b',
  'prosieben', 'sat\\.1', '\\bzdf\\b', 'das\\s*erste',
  'rom[aá]ntico', '\\bcine\\s+sony\\b',
  'america\\s*tev[eé]', 'acapulco\\s*shore',
  'ici\\s*radio[- ]?canada', 'radio[- ]?canada\\s*t[eé]l[eé]',
].join('|'), 'i');

// Non-Latin scripts (Cyrillic, Arabic, Hebrew, Devanagari, Thai, CJK, Hangul, Greek, etc.)
const NON_LATIN = /[\u0400-\u052F\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\u0370-\u03FF\u0F00-\u0FFF]/;

// Allowed Western accents that appear in English brand names (Café, etc.).
const ALLOWED_ACCENT = /[àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿœÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝŸŒ]/g;

function hasHeavyNonEnglishChars(name) {
  if (NON_LATIN.test(name)) return true;
  // Strip ASCII + allowed accents; any leftover Unicode letter ⇒ drop (Polish ł, Czech ř, ß, …)
  const rest = name.replace(/[\x00-\x7F]/g, '').replace(ALLOWED_ACCENT, '');
  return /\p{L}/u.test(rest);
}

function isNonEnglishName(name) {
  return NON_EN_NAME.test(name) || hasHeavyNonEnglishChars(name);
}

const CATALOGS = [
  { id: 'iptv-us', name: 'Live TV · United States', country: 'US' },
  { id: 'iptv-uk', name: 'Live TV · United Kingdom', country: 'UK' },
  { id: 'iptv-ca', name: 'Live TV · Canada', country: 'CA' },
  { id: 'iptv-freetv', name: 'Live TV · Free-TV Picks', freetv: true },
  { id: 'iptv-news', name: 'Live TV · News', cats: ['news', 'business', 'weather', 'legislative'] },
  { id: 'iptv-sports', name: 'Live TV · Sports', cats: ['sports', 'outdoor', 'auto'] },
  { id: 'iptv-movies', name: 'Live TV · Movies', cats: ['movies', 'classic'] },
  { id: 'iptv-music', name: 'Live TV · Music', cats: ['music'] },
  { id: 'iptv-kids', name: 'Live TV · Kids', cats: ['kids', 'animation', 'family'] },
  { id: 'iptv-entertainment', name: 'Live TV · Entertainment', cats: ['entertainment', 'series', 'comedy', 'lifestyle', 'cooking', 'travel'] },
  { id: 'iptv-documentary', name: 'Live TV · Documentary', cats: ['documentary', 'science', 'education', 'culture'] },
];

const manifest = {
  id: 'community.iptv.livetv.english', version: '1.1.0', name: 'IPTV Live TV (English)',
  description: 'English-language free live TV from public IPTV playlists (iptv-org, Free-TV).',
  resources: ['catalog', 'meta', 'stream'], types: ['tv'], idPrefixes: ['iptv:'],
  catalogs: CATALOGS.map(c => ({ type: 'tv', id: c.id, name: c.name,
    extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] })),
  behaviorHints: { configurable: false },
};

let db = { items: new Map(), lists: {}, loadedAt: null, source: 'empty' };
let refreshTimer = null;
let loading = false;

const hid = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const goodUrl = u => /^https?:\/\//i.test(u || '') && !/twitch\.tv|youtube\.com|youtu\.be|dailymotion/i.test(u);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, opts = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_TRIES; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      console.error(`fetch try ${attempt}/${FETCH_TRIES} failed:`, e.message || e);
      if (attempt < FETCH_TRIES) await sleep(1000 * Math.pow(2, attempt - 1)); // 1s, 2s
    }
  }
  throw lastErr;
}

function addItem(items, key, data, stream) {
  const id = hid(key);
  let it = items.get(id);
  if (!it) { it = { id, ...data, streams: [] }; items.set(id, it); }
  if (!it.streams.some(s => s.url === stream.url)) it.streams.push(stream);
  return id;
}

function emptyLists() {
  return Object.fromEntries(CATALOGS.map(c => [c.id, []]));
}

function serializeDb(d) {
  return {
    loadedAt: d.loadedAt,
    source: d.source,
    items: [...d.items.values()].map(it => ({
      id: it.id, name: it.name, logo: it.logo, genres: it.genres, country: it.country, streams: it.streams,
    })),
    lists: d.lists,
  };
}

function deserializeDb(raw) {
  const items = new Map();
  for (const it of raw.items || []) items.set(it.id, it);
  return {
    items,
    lists: raw.lists || emptyLists(),
    loadedAt: raw.loadedAt || null,
    source: 'cache',
  };
}

function saveCache(d) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(serializeDb(d)));
    console.log('Cache written', CACHE_FILE, '(' + d.items.size + ' channels)');
  } catch (e) {
    console.error('Cache write failed', e.message);
  }
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const d = deserializeDb(raw);
    if (!d.items.size) return null;
    console.log('Cache loaded', d.items.size, 'channels from', CACHE_FILE,
      d.loadedAt ? '(saved ' + d.loadedAt + ')' : '');
    return d;
  } catch (e) {
    console.error('Cache read failed', e.message);
    return null;
  }
}

async function buildDataset() {
  const getJson = async n => (await fetchWithRetry(API + n + '.json')).json();
  const [channels, streams, feeds, logos] = await Promise.all(
    ['channels', 'streams', 'feeds', 'logos'].map(getJson)
  );
  const ch = new Map(channels.filter(c => !c.is_nsfw && !c.closed).map(c => [c.id, c]));
  const feedLang = new Map(); const chanLang = new Map();
  for (const f of feeds) {
    feedLang.set(f.channel + '@' + f.id, f.languages || []);
    const l = chanLang.get(f.channel) || new Set(); (f.languages || []).forEach(x => l.add(x)); chanLang.set(f.channel, l);
  }
  const logo = new Map();
  for (const l of logos) if (!l.feed && (!logo.has(l.channel) || l.in_use)) logo.set(l.channel, l.url);

  const items = new Map();
  const lists = Object.fromEntries(CATALOGS.map(c => [c.id, new Set()]));
  let droppedName = 0;

  for (const s of streams) {
    const c = s.channel && ch.get(s.channel);
    if (!c || !goodUrl(s.url)) continue;
    const langs = s.feed
      ? (feedLang.get(c.id + '@' + s.feed) || [...(chanLang.get(c.id) || [])])
      : [...(chanLang.get(c.id) || [])];
    // English rule: has eng AND (English-speaking country OR eng is the only language)
    if (!langs.includes('eng')) continue;
    if (isNonEnglishName(c.name)) { droppedName++; continue; }
    if (!(EN_COUNTRIES.includes(c.country) || langs.length === 1)) continue;
    const headers = {};
    if (s.user_agent) headers['User-Agent'] = s.user_agent;
    if (s.referrer) headers['Referer'] = s.referrer;
    const stream = { url: s.url, title: `${c.name}${s.quality ? ' · ' + s.quality : ''} (live)`, headers };
    const id = addItem(items, 'n:' + c.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
      { name: c.name, logo: logo.get(c.id), genres: c.categories.map(cap), country: c.country }, stream);
    for (const cat of CATALOGS) {
      if (cat.country && (c.country === cat.country || (cat.country === 'UK' && c.country === 'GB'))) lists[cat.id].add(id);
      if (cat.cats && c.categories.some(x => cat.cats.includes(x))) lists[cat.id].add(id);
    }
  }

  // Free-TV
  try {
    const txt = await (await fetchWithRetry(FREETV)).text();
    const lines = txt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXTINF')) continue;
      const attr = k => (lines[i].match(new RegExp(k + '="([^"]*)"')) || [])[1] || '';
      let j = i + 1; while (j < lines.length && (lines[j].startsWith('#') || !lines[j].trim())) j++;
      const url = (lines[j] || '').trim();
      const group = attr('group-title'), country = attr('tvg-country').toUpperCase();
      const ok = FREETV_GROUPS.includes(group) || (FREETV_MIXED.includes(group) && EN_COUNTRIES.includes(country));
      if (!ok || !goodUrl(url)) continue;
      const name = lines[i].split(',').pop().replace(/[ⒼⓈⓎⓉⓂⓅⒸ]/g, ' ').trim();
      if (isNonEnglishName(name)) { droppedName++; continue; }
      const tid = attr('tvg-id');
      const key = 'n:' + (tid && ch.has(tid) ? ch.get(tid).name : name).toLowerCase().replace(/[^a-z0-9]/g, '');
      const id = addItem(items, key, { name, logo: attr('tvg-logo'), genres: [group] },
        { url, title: name + ' (live, Free-TV)', headers: {} });
      lists['iptv-freetv'].add(id);
    }
  } catch (e) {
    console.error('Free-TV load failed', e.message);
    // If we already have iptv-org data, continue with that rather than failing the whole load
    if (!items.size) throw e;
  }

  const sorted = {};
  for (const k in lists) sorted[k] = [...lists[k]].sort((a, b) => items.get(a).name.localeCompare(items.get(b).name));
  console.log('Name-filter dropped', droppedName, 'entries');
  return { items, lists: sorted, loadedAt: new Date().toISOString(), source: 'live' };
}

function scheduleRefresh(ms) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { refresh().catch(() => {}); }, ms);
}

async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const next = await buildDataset();
    db = next;
    saveCache(db);
    console.log('Loaded', db.items.size, 'channels;',
      Object.entries(db.lists).map(([k, v]) => k + '=' + v.length).join(' '));
    scheduleRefresh(REFRESH_MS);
  } catch (e) {
    console.error('refresh failed; keeping previous data:', e.message || e);
    // Keep serving whatever we have (memory or earlier cache). Retry sooner.
    scheduleRefresh(RETRY_AFTER_FAIL_MS);
  } finally {
    loading = false;
  }
}

const toMeta = it => ({ id: 'iptv:' + it.id, type: 'tv', name: it.name, poster: it.logo, posterShape: 'square',
  logo: it.logo, background: it.logo, genres: it.genres, description: (it.genres[0] || 'TV') + ' · live stream' });
const toStream = s => ({ url: s.url, title: s.title,
  behaviorHints: Object.keys(s.headers || {}).length ? { notWebReady: true, proxyHeaders: { request: s.headers } } : {} });

function parseExtra(str) {
  const o = {}; if (!str) return o;
  for (const p of str.split('&')) { const [k, v] = p.split('='); o[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' ')); }
  return o;
}

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*', 'Cache-Control': code === 200 ? 'max-age=60' : 'no-store' });
  res.end(JSON.stringify(body));
}

function catalogCounts() {
  const o = {};
  for (const c of CATALOGS) o[c.id] = (db.lists[c.id] || []).length;
  return o;
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '/manifest.json') return send(res, 200, manifest);
  if (urlPath === '/health') {
    return send(res, 200, {
      ok: true,
      version: manifest.version,
      channels: db.items.size,
      catalogs: catalogCounts(),
      loadedAt: db.loadedAt,
      source: db.source,
      loading,
    });
  }
  let m;
  if ((m = urlPath.match(/^\/catalog\/tv\/([^/]+?)(?:\/(.+))?\.json$/))) {
    const ids = db.lists[m[1]]; if (!ids) return send(res, 404, { metas: [] });
    const ex = parseExtra(m[2]); let list = ids.map(i => db.items.get(i)).filter(Boolean);
    if (ex.search) { const q = ex.search.toLowerCase(); list = list.filter(it => it.name.toLowerCase().includes(q)); }
    const skip = parseInt(ex.skip || '0', 10) || 0;
    return send(res, 200, { metas: list.slice(skip, skip + PAGE).map(toMeta) });
  }
  if ((m = urlPath.match(/^\/meta\/tv\/iptv:([^/]+)\.json$/))) {
    const it = db.items.get(m[1]); return it ? send(res, 200, { meta: toMeta(it) }) : send(res, 404, { meta: null });
  }
  if ((m = urlPath.match(/^\/stream\/tv\/iptv:([^/]+)\.json$/))) {
    const it = db.items.get(m[1]); return send(res, 200, { streams: it ? it.streams.map(toStream) : [] });
  }
  send(res, 404, { err: 'not found' });
}).listen(PORT, () => {
  console.log('Addon on http://localhost:' + PORT + '/manifest.json');
  // Serve immediately: hydrate from cache if present, then refresh in background.
  const cached = loadCache();
  if (cached) db = cached;
  refresh().catch(() => {});
});
