// Shared helpers for reading and writing projects.json.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_FILE = path.join(ROOT, 'projects.json');
export const PREVIEW_DIR = 'previews';

export function loadData() {
  return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
}

export function saveData(data) {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
}

export function hostOf(url) {
  return new URL(url).hostname.toLowerCase();
}

// "weather.theojaffee.net" -> "weather"; anything off-domain keeps its full host.
export function slugOf(host, domain) {
  const suffix = '.' + domain;
  const base = host.endsWith(suffix) ? host.slice(0, -suffix.length) : host;
  return base.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}
