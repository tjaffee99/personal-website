#!/usr/bin/env node
// Screenshots each project into previews/ for its thumbnail on the index page.
//
//   node scripts/capture-previews.mjs              # projects that have no thumbnail yet
//   node scripts/capture-previews.mjs --all        # retake every thumbnail
//   node scripts/capture-previews.mjs --list       # just report which would be captured
//   node scripts/capture-previews.mjs weather.theojaffee.net
//   node scripts/capture-previews.mjs congress.theojaffee.net=https://americanatlas.us/
//
// The host=url form screenshots a different address for a project, e.g. before its
// subdomain is live. Requires Playwright (except for --list):
//   npm install --no-save playwright && npx playwright install chromium

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, PREVIEW_DIR, loadData, saveData, hostOf, slugOf } from './projects-data.mjs';

// Lay the page out at 1280x800 and save it at half scale, 640x400.
const VIEWPORT = { width: 1280, height: 800 };
const SCALE = 0.5;
const SETTLE_MS = 4000;

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')));
const overrides = new Map();
const requested = new Set();
for (const arg of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const eq = arg.indexOf('=');
  const host = (eq === -1 ? arg : arg.slice(0, eq)).toLowerCase();
  requested.add(host);
  if (eq !== -1) overrides.set(host, arg.slice(eq + 1));
}

const data = loadData();
const targets = data.projects.filter((project) => {
  if (flags.has('--all')) return true;
  if (requested.size) return requested.has(hostOf(project.url));
  return !project.hidden && (!project.image || !existsSync(path.join(ROOT, project.image)));
});

if (flags.has('--list')) {
  for (const project of targets) console.log(hostOf(project.url));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${targets.length}\n`);
  process.exit(0);
}

if (!targets.length) {
  console.log('No thumbnails to capture.');
  process.exit(0);
}

const { chromium } = await import('playwright');
mkdirSync(path.join(ROOT, PREVIEW_DIR), { recursive: true });
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

let failures = 0;
for (const project of targets) {
  const host = hostOf(project.url);
  const file = `${PREVIEW_DIR}/${slugOf(host, data.domain)}.jpg`;
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: 'light' });
  try {
    await page.goto(overrides.get(host) ?? project.url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    writeFileSync(path.join(ROOT, file), await page.screenshot({ type: 'jpeg', quality: 82 }));
    project.image = file;
    console.log(`captured ${host}`);
  } catch (err) {
    failures++;
    console.warn(`could not capture ${host}: ${err.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();
saveData(data);
if (failures === targets.length) process.exit(1);
