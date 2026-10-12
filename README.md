# projects.theojaffee.net

An index of the things I've built, each living on its own subdomain of theojaffee.net.
It's a static GitHub Pages site that updates itself.

## How it works

- `index.html` + `assets/` render the page from **`projects.json`**, the single source of truth.
- `.github/workflows/discover-projects.yml` runs every six hours (and on demand from the Actions tab):
  1. `scripts/discover-projects.mjs` lists every `*.theojaffee.net` hostname that has ever had an
     HTTPS certificate, from the public certificate-transparency logs (crt.sh and CertSpotter). This
     finds new projects no matter where they're hosted: GitHub Pages, ChatGPT sites, anything.
  2. Any hostname that isn't already listed or ignored, and that serves a real page, gets added with
     the site's own title and description (`og:site_name` / `og:title` / `<title>`, then
     `og:description` / `description`). Its launch date is the date of its first certificate.
  3. `scripts/capture-previews.mjs` screenshots new projects into `previews/` with Playwright, in light
     mode and (if the site has one) dark mode.
  4. The workflow commits the changes and asks GitHub Pages to rebuild.

Existing entries are never overwritten, so feel free to edit names, descriptions and tags by hand.

## projects.json

```jsonc
{
  "domain": "theojaffee.net",
  "ignore": ["www.theojaffee.net", "*.staging.theojaffee.net"], // never auto-add these
  "projects": [
    {
      "url": "https://weather.theojaffee.net/",
      "name": "Weather Atlas",
      "description": "One or two sentences.",
      "tags": ["Climate"],            // up to 3 shown
      "launched": "2026-10-11",       // sets the order and the plate number
      "image": "previews/weather.jpg",
      "imageDark": "previews/weather-dark.jpg", // optional
      "hidden": true                  // optional: keep it listed but off the page
    }
  ]
}
```

To remove an auto-added project, delete it **and** add its hostname to `ignore`, or set `"hidden": true`,
otherwise the next run will add it again.

## Working locally

```sh
python3 -m http.server 8000              # then open http://localhost:8000
node scripts/discover-projects.mjs --dry-run

npm install --no-save playwright && npx playwright install chromium
node scripts/capture-previews.mjs        # screenshots for projects that lack one
node scripts/capture-previews.mjs --all  # retake every screenshot
```

## Setup

- DNS: `projects` CNAME → `tjaffee99.github.io`.
- Repo settings → Pages: deploy from the `main` branch, root folder; custom domain comes from `CNAME`.
- GitHub disables scheduled workflows in repos with no activity for 60 days. If that happens, re-enable
  "Discover new projects" from the Actions tab.

The older pages from my previous personal site (`books.html`, `links.html`, `travel.html`, `sfmap.html`)
are still in this repo.
