// IPTV Live TV (English) - Stremio addon. No dependencies (Node 18+ for global fetch).
const http = require('http');
const crypto = require('crypto');
const PORT = process.env.PORT || 7000;
const PAGE = 100;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const API = 'https://iptv-org.github.io/api/';
const FREETV = 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8';
const EN_COUNTRIES = ['US', 'GB', 'UK', 'CA', 'AU', 'NZ', 'IE'];
const FREETV_GROUPS = ['UK', 'USA', 'Canada', 'Australia', 'New Zealand', 'Ireland', 'VOD Movies (EN)'];
const FREETV_MIXED = ['News', 'Business', 'Weather']; // kept only if tvg-country is English-speaking

const NON_EN_NAME = /espa[nñ]ol|latino|latin pop|en vivo|deutsch|fran[cç]ais|arabic|hindi|urdu|t[uü]rk/i;
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
  id: 'community.iptv.livetv.english', version: '1.0.0', name: 'IPTV Live TV (English)',
  description: 'English-language free live TV from public IPTV playlists (iptv-org, Free-TV).',
  resources: ['catalog', 'meta', 'stream'], types: ['tv'], idPrefixes: ['iptv:'],
  catalogs: CATALOGS.map(c => ({ type: 'tv', id: c.id, name: c.name,
    extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] })),
  behaviorHints: { configurable: false },
};

let db = { items: new Map(), lists: {} }; // items: id -> {name, logo, genres, streams[]}
const hid = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const goodUrl = u => /^https?:\/\//i.test(u || '') && !/twitch\.tv|youtube\.com|youtu\.be|dailymotion/i.test(u);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const getJson = async n => (await fetch(API + n + '.json')).json();

function addItem(items, key, data, stream) {
  const id = hid(key);
  let it = items.get(id);
  if (!it) { it = { id, ...data, streams: [] }; items.set(id, it); }
  if (!it.streams.some(s => s.url === stream.url)) it.streams.push(stream);
  return id;
}

async function load() {
  const [channels, streams, feeds, logos] = await Promise.all(['channels', 'streams', 'feeds', 'logos'].map(getJson));
  const ch = new Map(channels.filter(c => !c.is_nsfw && !c.closed).map(c => [c.id, c]));
  const feedLang = new Map(); const chanLang = new Map();
  for (const f of feeds) {
    feedLang.set(f.channel + '@' + f.id, f.languages || []);
    const l = chanLang.get(f.channel) || new Set(); (f.languages || []).forEach(x => l.add(x)); chanLang.set(f.channel, l);
  }
  const logo = new Map();
  for (const l of logos) if (!l.feed && (!logo.has(l.channel) || l.in_use)) logo.set(l.channel, l.url);

  const items = new Map(); const lists = Object.fromEntries(CATALOGS.map(c => [c.id, new Set()]));
  for (const s of streams) {
    const c = s.channel && ch.get(s.channel);
    if (!c || !goodUrl(s.url)) continue;
    const langs = s.feed ? (feedLang.get(c.id + '@' + s.feed) || [...(chanLang.get(c.id) || [])]) : [...(chanLang.get(c.id) || [])];
    // English rule: has eng AND (English-speaking country OR eng is the only language)
    if (!langs.includes('eng') || NON_EN_NAME.test(c.name)) continue;
    if (!(EN_COUNTRIES.includes(c.country) || langs.length === 1)) continue;
    const headers = {};
    if (s.user_agent) headers['User-Agent'] = s.user_agent;
    if (s.referrer) headers['Referer'] = s.referrer;
    const stream = { url: s.url, title: `${c.name}${s.quality ? ' · ' + s.quality : ''} (live)`, headers };
    const id = addItem(items, 'n:' + c.name.toLowerCase().replace(/[^a-z0-9]/g, ''), { name: c.name, logo: logo.get(c.id), genres: c.categories.map(cap), country: c.country }, stream);
    for (const cat of CATALOGS) {
      if (cat.country && (c.country === cat.country || (cat.country === 'UK' && c.country === 'GB'))) lists[cat.id].add(id);
      if (cat.cats && c.categories.some(x => cat.cats.includes(x))) lists[cat.id].add(id);
    }
  }
  // Free-TV
  try {
    const txt = await (await fetch(FREETV)).text();
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
      const tid = attr('tvg-id');
      const key = 'n:' + (tid && ch.has(tid) ? ch.get(tid).name : name).toLowerCase().replace(/[^a-z0-9]/g, '');
      const id = addItem(items, key, { name, logo: attr('tvg-logo'), genres: [group] }, { url, title: name + ' (live, Free-TV)', headers: {} });
      lists['iptv-freetv'].add(id);
    }
  } catch (e) { console.error('Free-TV load failed', e.message); }

  const sorted = {};
  for (const k in lists) sorted[k] = [...lists[k]].sort((a, b) => items.get(a).name.localeCompare(items.get(b).name));
  db = { items, lists: sorted };
  console.log('Loaded', items.size, 'channels;', Object.entries(sorted).map(([k, v]) => k + '=' + v.length).join(' '));
}

const toMeta = it => ({ id: 'iptv:' + it.id, type: 'tv', name: it.name, poster: it.logo, posterShape: 'square',
  logo: it.logo, background: it.logo, genres: it.genres, description: (it.genres[0] || 'TV') + ' · live stream' });
const toStream = s => ({ url: s.url, title: s.title,
  behaviorHints: Object.keys(s.headers).length ? { notWebReady: true, proxyHeaders: { request: s.headers } } : {} });

function parseExtra(str) {
  const o = {}; if (!str) return o;
  for (const p of str.split('&')) { const [k, v] = p.split('='); o[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' ')); }
  return o;
}

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*', 'Cache-Control': 'max-age=3600' });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/' || path === '/manifest.json') return send(res, 200, manifest);
  let m;
  if ((m = path.match(/^\/catalog\/tv\/([^/]+?)(?:\/(.+))?\.json$/))) {
    const ids = db.lists[m[1]]; if (!ids) return send(res, 404, { metas: [] });
    const ex = parseExtra(m[2]); let list = ids.map(i => db.items.get(i));
    if (ex.search) { const q = ex.search.toLowerCase(); list = list.filter(it => it.name.toLowerCase().includes(q)); }
    const skip = parseInt(ex.skip || '0', 10) || 0;
    return send(res, 200, { metas: list.slice(skip, skip + PAGE).map(toMeta) });
  }
  if ((m = path.match(/^\/meta\/tv\/iptv:([^/]+)\.json$/))) {
    const it = db.items.get(m[1]); return it ? send(res, 200, { meta: toMeta(it) }) : send(res, 404, { meta: null });
  }
  if ((m = path.match(/^\/stream\/tv\/iptv:([^/]+)\.json$/))) {
    const it = db.items.get(m[1]); return send(res, 200, { streams: it ? it.streams.map(toStream) : [] });
  }
  send(res, 404, { err: 'not found' });
}).listen(PORT, () => console.log('Addon on http://localhost:' + PORT + '/manifest.json'));

load().catch(e => console.error('load failed', e));
setInterval(() => load().catch(e => console.error('refresh failed', e)), REFRESH_MS);
