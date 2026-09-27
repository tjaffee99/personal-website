# China Rail Atlas

Interactive map of China's high-speed, conventional, metro, light rail and tram
networks. Intended to be served at <https://chinarail.theojaffee.net>.

A fully static site: no build step, no API keys.

```
index.html          page shell
style.css           UI styles (light + dark)
app.js              map style, search, line/station panels
favicon.svg
vendor/             MapLibre GL JS 5.24.0 (self-hosted)
data/network.json   lines, stations, cities (OpenStreetMap, extracted 25 Sep 2026)
data/manifest.json  index into the rail tile chunks
data/tiles/*.bin    rail vector tiles (z3–12), packed into chunk files
data/glyphs/        Noto Sans label glyphs (Latin/Greek/punctuation ranges)
CNAME               chinarail.theojaffee.net
```

The base map (streets, buildings, water, parks, place and POI labels, worldwide,
zoom 0–14 overzoomed to 19) streams from [OpenFreeMap](https://openfreemap.org),
which is free and needs no key. Glyph ranges not bundled locally (Cyrillic, Thai,
etc.) also come from OpenFreeMap; Chinese characters use the system font.

The map position is kept in the URL (`#view=zoom/lat/lng`), so links are shareable.

## Run locally

```
python3 -m http.server -d chinarail 8000   # then open http://localhost:8000
```

## Deploying on the subdomain

GitHub Pages allows one custom domain per repository, and this repository already
serves `theojaffee.net` (so this folder is also live at `theojaffee.net/chinarail/`).
To serve it at `chinarail.theojaffee.net`:

1. Put the contents of this folder at the root of its own repository
   (e.g. `tjaffee99/chinarail`), keeping the `CNAME` file, and enable
   Pages for it (Settings → Pages → deploy from branch).
2. Add a DNS record: `CNAME  chinarail  →  tjaffee99.github.io`.
3. Once the certificate is issued, tick "Enforce HTTPS".

Any other static host (Cloudflare Pages, Netlify, Vercel) works too: point it at
this folder with no build command.
