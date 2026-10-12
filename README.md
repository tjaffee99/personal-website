# projects.theojaffee.net

A list of the things I've built, each living on its own subdomain of theojaffee.net.
It's a static GitHub Pages site that updates itself.

## How it works

- `index.html` renders the list from **`projects.json`**, newest first, each with a thumbnail from
  `previews/`. Links open in a new tab.
- `.github/workflows/discover-projects.yml` runs every six hours (and on demand from the Actions tab).
  It runs `scripts/discover-projects.mjs`, which lists every `*.theojaffee.net` hostname that has had an
  HTTPS certificate, using the public certificate-transparency logs (crt.sh and CertSpotter). Any
  hostname that isn't already in `projects.json` or `ignore`, and that serves a real page, gets added
  with the site's own title and description. Its date is the date of its first certificate.
  `scripts/capture-previews.mjs` then screenshots it with Playwright for its thumbnail (640×400).

Existing entries are never overwritten, so edit names and descriptions by hand freely.

## projects.json

```jsonc
{
  "domain": "theojaffee.net",
  "ignore": ["www.theojaffee.net"],      // never auto-add these
  "projects": [
    {
      "url": "https://weather.theojaffee.net/",
      "name": "Weather Atlas",
      "description": "One sentence.",
      "launched": "2026-10-11",          // sets the order
      "image": "previews/weather.jpg",
      "hidden": true                     // optional: keep it off the page for now
    }
  ]
}
```

To drop a project for good, delete it and add its hostname to `ignore`; otherwise the next run adds it
back. To hold one back until it's ready, set `"hidden": true`, and remove that line to publish it.

## Working locally

```sh
python3 -m http.server 8000                    # then open http://localhost:8000
node scripts/discover-projects.mjs --dry-run   # see what the next run would add

npm install --no-save playwright && npx playwright install chromium
node scripts/capture-previews.mjs              # thumbnails for projects that lack one
node scripts/capture-previews.mjs --all        # retake every thumbnail
```

## Setup

- DNS: `projects` CNAME → `tjaffee99.github.io`.
- Repo settings → Pages: deploy from the `main` branch, root folder; the custom domain comes from `CNAME`.
- GitHub disables scheduled workflows in repos with no activity for 60 days. If that happens, re-enable
  "Discover new projects" from the Actions tab.

The older pages from my previous personal site (`books.html`, `links.html`, `travel.html`, `sfmap.html`)
are still in this repo.

`flights/` is Flight Atlas, a globe of every passenger air route; see `flights/README.md`.
