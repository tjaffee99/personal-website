#!/usr/bin/env node
// Finds new *.theojaffee.net projects and adds them to projects.json.
//
// Subdomains come from public certificate-transparency logs (crt.sh and CertSpotter),
// so a project is found no matter where it is hosted. A subdomain is added once it
// serves a real HTML page, using the page's own title and description. Existing
// entries are never touched, so hand edits stick; hosts in "ignore" are skipped.
//
//   node scripts/discover-projects.mjs            # update projects.json
//   node scripts/discover-projects.mjs --dry-run  # only report what would be added
//
// In GitHub Actions it writes `added` (a count) and `message` (a commit message) to $GITHUB_OUTPUT.

import { appendFileSync } from 'node:fs';
import { loadData, saveData, hostOf } from './projects-data.mjs';

const USER_AGENT = 'projects.theojaffee.net discovery (+https://projects.theojaffee.net)';
const MAX_DESCRIPTION = 220;
const dryRun = process.argv.includes('--dry-run');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, { tries = 3, timeout = 60_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < tries) await sleep(2000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

// Certificate sources each return Map<hostname, earliest certificate date (YYYY-MM-DD)>.
function record(hosts, name, notBefore) {
  const host = name.trim().toLowerCase();
  if (!host || host.startsWith('*.')) return;
  const date = String(notBefore).slice(0, 10);
  if (!hosts.has(host) || date < hosts.get(host)) hosts.set(host, date);
}

async function fromCrtSh(domain) {
  const response = await fetchWithRetry(`https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`, { timeout: 90_000 });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const hosts = new Map();
  for (const cert of await response.json()) {
    for (const name of String(cert.name_value).split('\n')) record(hosts, name, cert.not_before);
  }
  return hosts;
}

async function fromCertSpotter(domain) {
  const hosts = new Map();
  let after = '';
  for (let page = 0; page < 25; page++) {
    const url = `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}`
      + `&include_subdomains=true&expand=dns_names${after ? `&after=${after}` : ''}`;
    const response = await fetchWithRetry(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const certs = await response.json();
    if (!certs.length) break;
    for (const cert of certs) for (const name of cert.dns_names) record(hosts, name, cert.not_before);
    after = certs[certs.length - 1].id;
  }
  return hosts;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', middot: '·' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const clean = (text) => decodeEntities(text ?? '').replace(/\s+/g, ' ').trim();

// "Global Capital Atlas — Company HQ Map" -> "Global Capital Atlas"
function shortTitle(title) {
  return title.split(/\s+[—–|·-]\s+/)[0].trim();
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, text.lastIndexOf(' ', max - 1)).replace(/[\s,;:.]+$/, '') + '…';
}

function readMetadata(html) {
  const head = html.split(/<\/head>/i)[0];
  const meta = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = {};
    for (const [, key, , dq, sq] of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[key.toLowerCase()] = dq ?? sq;
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content && !(key in meta)) meta[key] = clean(attrs.content);
  }
  const title = clean(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  return {
    name: meta['og:site_name'] || shortTitle(meta['og:title'] || title),
    title,
    description: meta['og:description'] || meta.description || meta['twitter:description'] || '',
  };
}

function prettify(host, domain) {
  const label = host.slice(0, -(domain.length + 1)).split('.')[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Returns metadata if the host serves a real page of its own, otherwise null.
async function inspect(host, domain) {
  let response;
  try {
    response = await fetchWithRetry(`https://${host}/`, { tries: 2, timeout: 20_000 });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  if (hostOf(response.url) !== host) return null; // an alias that redirects to another site
  if (!/html/i.test(response.headers.get('content-type') ?? '')) return null;
  const html = (await response.text()).slice(0, 500_000);
  const meta = readMetadata(html);
  if (/site not found|page not found|^404\b|domain (is )?for sale|parked/i.test(meta.title)) return null;
  return {
    name: meta.name || prettify(host, domain),
    description: truncate(meta.description, MAX_DESCRIPTION),
  };
}

function isIgnored(host, ignore) {
  return ignore.some((pattern) => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern));
}

const data = loadData();
const domain = data.domain;
const ignore = (data.ignore ?? []).map((h) => h.toLowerCase());
const listed = new Set(data.projects.map((project) => hostOf(project.url)));

const sources = await Promise.allSettled([fromCrtSh(domain), fromCertSpotter(domain)]);
const seen = new Map();
sources.forEach((result, i) => {
  const label = ['crt.sh', 'CertSpotter'][i];
  if (result.status === 'rejected') {
    console.warn(`::warning::${label} failed: ${result.reason?.message ?? result.reason}`);
    return;
  }
  console.log(`${label}: ${result.value.size} names`);
  for (const [host, date] of result.value) record(seen, host, date);
});
if (sources.every((result) => result.status === 'rejected')) {
  console.error('No certificate-transparency source answered; try again later.');
  process.exit(1);
}

const candidates = [...seen.keys()]
  .filter((host) => host.endsWith(`.${domain}`) && !listed.has(host) && !isIgnored(host, ignore))
  .sort();

const added = [];
for (const host of candidates) {
  const meta = await inspect(host, domain);
  if (!meta) {
    console.log(`skip ${host} (not serving a page yet)`);
    continue;
  }
  console.log(`new  ${host}: ${meta.name}`);
  added.push({ url: `https://${host}/`, name: meta.name, description: meta.description, launched: seen.get(host) });
}

if (added.length && !dryRun) {
  added.sort((a, b) => b.launched.localeCompare(a.launched));
  data.projects.unshift(...added);
  saveData(data);
}

console.log(added.length ? `Added ${added.length} project(s).` : 'No new projects.');
if (process.env.GITHUB_OUTPUT) {
  const names = added.map((project) => `${project.name} (${hostOf(project.url)})`).join(', ');
  const message = `Add ${names} to projects`.replace(/[\r\n]+/g, ' ').slice(0, 200);
  appendFileSync(process.env.GITHUB_OUTPUT, `added=${added.length}\nmessage=${message}\n`);
}
