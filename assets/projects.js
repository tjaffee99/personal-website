import { animateContours, drawStillContours } from './contours.js';

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const LONG_MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const slot = (name) => document.querySelector(`[data-slot="${name}"]`);
const stat = (name) => document.querySelector(`[data-stat="${name}"]`);

// Builds DOM without innerHTML: names and descriptions can be scraped from other sites.
function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'style') node.style.cssText = value;
        else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
        if (child != null && child !== false) node.append(child);
    }
    return node;
}

function roman(n) {
    const numerals = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
        [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [value, numeral] of numerals) {
        while (n >= value) { out += numeral; n -= value; }
    }
    return out;
}

// Project links must be https; images may also be paths on this site.
function safeUrl(value, { allowRelative = false } = {}) {
    if (typeof value !== 'string' || !value) return null;
    try {
        const url = new URL(value, location.href);
        if (url.protocol === 'https:') return url.href;
        if (allowRelative && url.origin === location.origin) return url.href;
    } catch { /* fall through */ }
    return null;
}

function hashString(text) {
    let h = 2166136261;
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
}

function normalize(raw, domain) {
    if (!raw || raw.hidden) return null;
    const href = safeUrl(raw.url);
    if (!href) return null;
    const host = new URL(href).hostname;
    const suffix = `.${domain}`;
    const sub = host.endsWith(suffix) ? host.slice(0, -suffix.length) : null;
    const launched = /^\d{4}-\d{2}-\d{2}$/.test(raw.launched ?? '') ? new Date(`${raw.launched}T00:00:00Z`) : null;
    return {
        href,
        host,
        sub,
        id: (sub ?? host).replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
        name: String(raw.name || host),
        description: String(raw.description || ''),
        tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 3).map(String) : [],
        launched,
        image: safeUrl(raw.image, { allowRelative: true }),
        imageDark: safeUrl(raw.imageDark, { allowRelative: true }),
    };
}

function placeholder(project) {
    const canvas = el('canvas', { 'aria-hidden': 'true' });
    requestAnimationFrame(() => drawStillContours(canvas, hashString(project.host)));
    return [canvas, el('span', { class: 'placeholder-name' }, project.name)];
}

function preview(project, eager) {
    if (!project.image) return placeholder(project);
    const img = el('img', {
        src: project.image,
        alt: `Screenshot of ${project.name}`,
        width: 1280,
        height: 800,
        loading: eager ? 'eager' : 'lazy',
        fetchpriority: eager ? 'high' : null,
        decoding: 'async',
    });
    const picture = project.imageDark
        ? el('picture', {}, el('source', { srcset: project.imageDark, media: '(prefers-color-scheme: dark)' }), img)
        : img;
    img.addEventListener('error', () => picture.replaceWith(...placeholder(project)), { once: true });
    return picture;
}

function hostLabel(project) {
    if (!project.sub) return project.host;
    return [project.sub, el('span', {}, project.host.slice(project.sub.length))];
}

function plate(project, { featured = false } = {}) {
    const meta = el('div', { class: 'plate-meta' },
        project.tags.length ? el('ul', { class: 'tags' }, project.tags.map((tag) => el('li', {}, tag))) : el('span'),
        project.launched ? el('time', { datetime: project.launched.toISOString().slice(0, 10) }, MONTH_YEAR.format(project.launched)) : null);

    const link = el('a', { class: 'plate-link', href: project.href },
        el('figure', { class: 'plate-figure' },
            preview(project, featured),
            el('span', { class: 'chip chip-no' }, `Plate ${roman(project.number)}`),
            featured ? el('span', { class: 'chip chip-latest' }, 'Latest') : null,
            el('span', { class: 'chip chip-visit', 'aria-hidden': 'true' }, 'Visit ↗')),
        el('div', { class: 'plate-body' },
            el(featured ? 'h2' : 'h3', { class: 'plate-title' }, project.name),
            el('p', { class: 'plate-host' }, hostLabel(project)),
            project.description ? el('p', { class: 'plate-desc' }, project.description) : null,
            meta));

    return featured
        ? el('article', { class: 'plate reveal', id: project.id }, link)
        : el('li', { class: 'plate reveal', id: project.id }, link);
}

function tocEntry(project) {
    return el('li', {},
        el('a', { href: `#${project.id}` },
            el('span', { class: 'num' }, roman(project.number)),
            el('span', { class: 'name' }, project.name),
            el('span', { class: 'leader', 'aria-hidden': 'true' }),
            el('span', { class: 'date' }, project.launched ? MONTH_YEAR.format(project.launched) : '')));
}

function revealOnScroll(nodes) {
    if (!('IntersectionObserver' in window)) {
        nodes.forEach((node) => node.classList.add('is-visible'));
        return;
    }
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
        }
    }, { rootMargin: '0px 0px -8% 0px' });
    nodes.forEach((node, i) => {
        node.style.setProperty('--delay', `${(i % 3) * 90}ms`);
        observer.observe(node);
    });
}

function render(data) {
    const domain = typeof data.domain === 'string' ? data.domain : 'theojaffee.net';
    const projects = (Array.isArray(data.projects) ? data.projects : [])
        .map((raw) => normalize(raw, domain))
        .filter(Boolean);

    // Plate numbers follow launch order, so a new project always gets the next number.
    const byLaunch = [...projects].sort((a, b) => (a.launched ?? Infinity) - (b.launched ?? Infinity));
    byLaunch.forEach((project, i) => { project.number = i + 1; });
    const newestFirst = [...byLaunch].reverse();

    if (!newestFirst.length) {
        showStatus('No projects yet. Check back soon.');
        return;
    }

    const dated = byLaunch.filter((p) => p.launched);
    stat('count').textContent = String(projects.length).padStart(2, '0');
    stat('since').textContent = dated.length ? LONG_MONTH_YEAR.format(dated[0].launched) : '—';
    stat('latest').textContent = dated.length ? MONTH_DAY.format(dated[dated.length - 1].launched) : '—';

    slot('toc').replaceChildren(...newestFirst.map(tocEntry));

    const [latest, ...rest] = newestFirst;
    const featured = plate(latest, { featured: true });
    slot('featured').replaceChildren(featured);
    const plates = rest.map((project) => plate(project));
    slot('plates').replaceChildren(...plates);
    revealOnScroll([featured, ...plates]);
}

function showStatus(message) {
    const status = slot('status');
    status.replaceChildren(message, ' ', el('a', { href: 'https://theojaffee.net' }, 'theojaffee.net'));
    status.hidden = false;
}

stat('year').textContent = String(new Date().getFullYear());
animateContours(document.querySelector('.contours'), document.querySelector('.hero'));

fetch('projects.json', { cache: 'no-cache' })
    .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    })
    .then(render)
    .catch((err) => {
        console.error('Could not load projects.json', err);
        showStatus('The project list failed to load. In the meantime, say hi at');
    });
