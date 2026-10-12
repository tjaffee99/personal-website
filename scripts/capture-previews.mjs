#!/usr/bin/env node
// Screenshots each project into previews/ so the index page has a picture to show.
// Captures a light and (when the site actually has one) a dark variant.
//
//   node scripts/capture-previews.mjs              # projects that have no preview yet
//   node scripts/capture-previews.mjs --all        # recapture every project
//   node scripts/capture-previews.mjs --list       # just report which would be captured
//   node scripts/capture-previews.mjs weather.theojaffee.net
//   node scripts/capture-previews.mjs congress.theojaffee.net=https://americanatlas.us/
//
// The host=url form screenshots a different address for a project, e.g. before its
// subdomain is live. Requires Playwright (except for --list):
//   npm install --no-save playwright && npx playwright install chromium

import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, PREVIEW_DIR, loadData, saveData, hostOf, slugOf } from './projects-data.mjs';

const VIEWPORT = { width: 1280, height: 800 };
const SETTLE_MS = 4000;
// Mean luminance (0-1) difference above which the dark capture counts as a real dark theme.
const DARK_THEME_THRESHOLD = 0.12;

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
  if (project.hidden) return false;
  if (flags.has('--all')) return true;
  if (requested.size) return requested.has(hostOf(project.url));
  return !project.image || !existsSync(path.join(ROOT, project.image));
});

if (flags.has('--list')) {
  for (const project of targets) console.log(hostOf(project.url));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${targets.length}\n`);
  process.exit(0);
}

if (!targets.length) {
  console.log('No previews to capture.');
  process.exit(0);
}

const { chromium } = await import('playwright');
mkdirSync(path.join(ROOT, PREVIEW_DIR), { recursive: true });
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function shoot(url, colorScheme) {
  const page = await browser.newPage({ viewport: VIEWPORT, colorScheme });
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 80 });
    return { jpeg, luminance: await meanLuminance(page, jpeg) };
  } finally {
    await page.close();
  }
}

// Decode the screenshot in the browser itself to avoid an image library dependency.
async function meanLuminance(page, jpeg) {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = new OffscreenCanvas(64, 40);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 64, 40);
    const px = ctx.getImageData(0, 0, 64, 40).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    return sum / (px.length / 4) / 255;
  }, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
}

let failures = 0;
for (const project of targets) {
  const host = hostOf(project.url);
  const url = overrides.get(host) ?? project.url;
  const slug = slugOf(host, data.domain);
  const lightPath = `${PREVIEW_DIR}/${slug}.jpg`;
  const darkPath = `${PREVIEW_DIR}/${slug}-dark.jpg`;
  try {
    const light = await shoot(url, 'light');
    const dark = await shoot(url, 'dark');
    writeFileSync(path.join(ROOT, lightPath), light.jpeg);
    project.image = lightPath;
    if (Math.abs(light.luminance - dark.luminance) > DARK_THEME_THRESHOLD) {
      writeFileSync(path.join(ROOT, darkPath), dark.jpeg);
      project.imageDark = darkPath;
    } else {
      rmSync(path.join(ROOT, darkPath), { force: true });
      delete project.imageDark;
    }
    console.log(`captured ${host} (light ${light.luminance.toFixed(2)}, dark ${dark.luminance.toFixed(2)})`);
  } catch (err) {
    failures++;
    console.warn(`could not capture ${host}: ${err.message}`);
  }
}

await browser.close();
saveData(data);
if (failures === targets.length) process.exit(1);
