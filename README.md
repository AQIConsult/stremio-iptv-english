# IPTV Live TV (English) — Stremio addon

English-only free live TV, built from public playlists (iptv-org API + Free-TV). No dependencies; needs Node 18+.

Catalogs: United States, United Kingdom, Canada, Free-TV Picks, News, Sports, Movies, Music, Kids, Entertainment, Documentary. Each supports search and paging (100 per page). Data refreshes in memory every 6 hours.

## Run locally
    node index.js        # http://localhost:7000/manifest.json  (PORT env var to change)

## Deploy free on Render
1. Create a GitHub repo and upload these files (index.js, package.json, render.yaml, README.md).
2. On https://render.com sign in, click **New + → Web Service**, connect the repo.
3. Runtime: Node. Build command: `npm install`. Start command: `node index.js`. Instance type: Free.
   (Or use **New + → Blueprint** and Render reads render.yaml.)
4. Click **Create Web Service**. Wait for "Live"; note the URL, e.g. `https://stremio-iptv-english.onrender.com`.
   Free instances sleep after ~15 min idle; first load after that takes ~30-60 s.

## Install in Stremio
Open `stremio://YOUR-HOST.onrender.com/manifest.json` (or paste `https://YOUR-HOST.onrender.com/manifest.json` into Stremio → Add-ons → search box). Click Install. Channels appear under Discover → TV.

## English filter
iptv-org channels are kept only if a feed language includes `eng` AND (the channel's country is US/UK/CA/AU/NZ/IE OR English is its only language); names containing Español/Latino/Hindi/Arabic etc. are dropped. Free-TV entries are kept only from groups UK, USA, Canada, Australia, New Zealand, Ireland, VOD Movies (EN), plus News/Business/Weather when tvg-country is English-speaking. Twitch/YouTube/Dailymotion page links are dropped; channels are deduped by name with their streams merged. Edit `EN_COUNTRIES`, `FREETV_GROUPS`, `CATALOGS` at the top of index.js to tweak.
