# IPTV Live TV (English) — Stremio addon

English-only free live TV, built from public playlists (iptv-org API + Free-TV). No dependencies; needs Node 18+.

Catalogs: United States, United Kingdom, Canada, Free-TV Picks, News, Sports, Movies, Music, Kids, Entertainment, Documentary. Each supports search and paging (100 per page). Data refreshes in memory every 6 hours (retries after 10 minutes on failure).

## Run locally
    node index.js        # http://localhost:7000/manifest.json  (PORT env var to change)

Optional env vars:
- `PORT` — listen port (default 7000)
- `CACHE_FILE` — path for the last-good channel cache (default `./cache.json`)
- `IPTV_API` / `FREETV_URL` — override source URLs (useful for testing)

On start the server listens immediately, serves any existing `cache.json`, then refreshes from the network in the background. If a refresh fails it keeps serving the previous data. **Note:** on Render’s free plan the disk is ephemeral, so the cache is lost on every redeploy/restart; it still helps across sleep/wake within the same instance and speeds cold starts after the first successful load in that instance.

## Health check / keep-awake
`GET /health` returns JSON with channel counts, `loadedAt`, and `source` (`live` / `cache` / `empty`). Point a free uptime pinger (UptimeRobot, cron-job.org, etc.) at `https://YOUR-HOST/health` every 5–10 minutes if you want to reduce Render free-tier sleep.

## Deploy free on Render
1. Create a GitHub repo and upload these files (index.js, package.json, render.yaml, README.md).
2. On https://render.com sign in, click **New + → Web Service**, connect the repo.
3. Runtime: Node. Build command: `npm install`. Start command: `node index.js`. Instance type: Free.
   (Or use **New + → Blueprint** and Render reads render.yaml.)
4. Click **Create Web Service**. Wait for "Live"; note the URL, e.g. `https://stremio-iptv-english.onrender.com`.
   Free instances sleep after ~15 min idle; first load after that takes ~30-60 s (or use `/health` pinger above).

## Install in Stremio
Open `stremio://YOUR-HOST.onrender.com/manifest.json` (or paste `https://YOUR-HOST.onrender.com/manifest.json` into Stremio → Add-ons → search box). Click Install. Channels appear under Discover → TV.

## English filter
iptv-org channels are kept only if a feed language includes `eng` AND (the channel's country is US/UK/CA/AU/NZ/IE OR English is its only language). Names matching a non-English blocklist (Deportes, Polska, Telemundo, Univision, Rai Italia, Latin America, etc.) or containing non-Latin scripts / heavy non-English diacritics are dropped (common accents like é in "Café" are allowed). The same name filter is applied to Free-TV entries. Free-TV groups kept: UK, USA, Canada, Australia, New Zealand, Ireland, VOD Movies (EN), plus News/Business/Weather when tvg-country is English-speaking. Twitch/YouTube/Dailymotion page links are dropped; channels are deduped by name with their streams merged. Edit `EN_COUNTRIES`, `FREETV_GROUPS`, `NON_EN_NAME`, `CATALOGS` at the top of index.js to tweak.
