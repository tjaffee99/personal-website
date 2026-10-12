// Topographic contour lines: 3D simplex noise sampled on a grid and traced with
// marching squares. Time is the third noise axis, so the terrain slowly morphs,
// and it rises into a hill wherever the mouse is.

const GRAD3 = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];
const F3 = 1 / 3;
const G3 = 1 / 6;

// Simplex noise after Stefan Gustavson, with a seeded permutation table. Returns roughly [-1, 1].
function createNoise(seed) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed >>> 0 || 1;
    const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    const perm = new Uint8Array(512);
    const permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
        perm[i] = p[i & 255];
        permMod12[i] = perm[i] % 12;
    }

    function corner(x, y, z, gi) {
        let t = 0.6 - x * x - y * y - z * z;
        if (t < 0) return 0;
        const g = GRAD3[gi];
        t *= t;
        return t * t * (g[0] * x + g[1] * y + g[2] * z);
    }

    return function noise3(xin, yin, zin) {
        const s = (xin + yin + zin) * F3;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const k = Math.floor(zin + s);
        const t = (i + j + k) * G3;
        const x0 = xin - (i - t);
        const y0 = yin - (j - t);
        const z0 = zin - (k - t);
        let i1, j1, k1, i2, j2, k2;
        if (x0 >= y0) {
            if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
            else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
            else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
        } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        const ii = i & 255;
        const jj = j & 255;
        const kk = k & 255;
        return 32 * (
            corner(x0, y0, z0, permMod12[ii + perm[jj + perm[kk]]]) +
            corner(x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]) +
            corner(x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]) +
            corner(x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3, permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]])
        );
    };
}

function line(path, x1, y1, x2, y2) {
    path.moveTo(x1, y1);
    path.lineTo(x2, y2);
}

// One marching-squares cell. Corners: a top-left, b top-right, c bottom-right, d bottom-left.
function traceCell(path, px, py, size, a, b, c, d, level) {
    const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
    if (idx === 0 || idx === 15) return;
    const r = px + size;
    const btm = py + size;
    const top = px + (size * (level - a)) / (b - a);
    const right = py + (size * (level - b)) / (c - b);
    const bottom = px + (size * (level - d)) / (c - d);
    const left = py + (size * (level - a)) / (d - a);
    switch (idx) {
        case 1: case 14: line(path, px, left, bottom, btm); break;
        case 2: case 13: line(path, bottom, btm, r, right); break;
        case 3: case 12: line(path, px, left, r, right); break;
        case 4: case 11: line(path, top, py, r, right); break;
        case 5: line(path, px, left, top, py); line(path, bottom, btm, r, right); break;
        case 6: case 9: line(path, top, py, bottom, btm); break;
        case 7: case 8: line(path, px, left, top, py); break;
        case 10: line(path, top, py, r, right); line(path, px, left, bottom, btm); break;
    }
}

function readColors() {
    const style = getComputedStyle(document.documentElement);
    return {
        contour: style.getPropertyValue('--contour').trim() || 'rgba(0,0,0,0.1)',
        index: style.getPropertyValue('--contour-index').trim() || 'rgba(217,70,30,0.4)',
    };
}

export function createContours(canvas, { seed = 7, cell = 9, scale = 1 / 280, step = 0.045 } = {}) {
    const ctx = canvas.getContext('2d');
    const noise = createNoise(seed);
    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let field = new Float32Array(0);
    let colors = readColors();

    function resize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = rect.width;
        height = rect.height;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cols = Math.ceil(width / cell);
        rows = Math.ceil(height / cell);
        field = new Float32Array((cols + 1) * (rows + 1));
    }

    function draw(time, bump) {
        const hasBump = bump && bump.amp > 0.002;
        let i = 0;
        for (let y = 0; y <= rows; y++) {
            const py = y * cell;
            for (let x = 0; x <= cols; x++, i++) {
                const px = x * cell;
                let v = 0.5
                    + 0.36 * noise(px * scale + time * 0.35, py * scale, time)
                    + 0.14 * noise(px * scale * 2.3, py * scale * 2.3, time * 1.6 + 17);
                if (hasBump) {
                    const dx = px - bump.x;
                    const dy = py - bump.y;
                    v += bump.amp * Math.exp(-(dx * dx + dy * dy) / bump.spread);
                }
                field[i] = v;
            }
        }

        // Only visit the levels each cell actually spans; every fifth is a bold index contour.
        const regular = new Path2D();
        const index = new Path2D();
        const stride = cols + 1;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const k = y * stride + x;
                const a = field[k];
                const b = field[k + 1];
                const c = field[k + stride + 1];
                const d = field[k + stride];
                const lo = Math.min(a, b, c, d);
                const hi = Math.max(a, b, c, d);
                for (let n = Math.ceil(lo / step); n * step < hi; n++) {
                    traceCell(n % 5 === 0 ? index : regular, x * cell, y * cell, cell, a, b, c, d, n * step);
                }
            }
        }

        ctx.clearRect(0, 0, width, height);
        ctx.lineCap = 'round';
        ctx.lineWidth = 1;
        ctx.strokeStyle = colors.contour;
        ctx.stroke(regular);
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = colors.index;
        ctx.stroke(index);
    }

    return {
        resize,
        draw,
        refreshColors() { colors = readColors(); },
    };
}

// The hero background: animates while on screen, and holds still for reduced motion.
export function animateContours(canvas, hoverTarget) {
    const narrow = window.matchMedia('(max-width: 640px)').matches;
    const contours = createContours(canvas, { seed: 1776, cell: narrow ? 11 : 9 });
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const bump = { x: 0, y: 0, amp: 0, spread: 2 * 120 * 120 };
    const target = { x: 0, y: 0, amp: 0 };
    let time = 3.2;
    let last = 0;
    let frame = 0;
    let onScreen = true;

    const still = () => reduceMotion.matches;
    const drawOnce = () => contours.draw(time, null);

    function tick(now) {
        frame = requestAnimationFrame(tick);
        if (now - last < 33) return;
        const dt = last ? Math.min(now - last, 100) : 16;
        last = now;
        time += dt * 0.00004;
        bump.x += (target.x - bump.x) * 0.12;
        bump.y += (target.y - bump.y) * 0.12;
        bump.amp += (target.amp - bump.amp) * 0.05;
        contours.draw(time, bump);
    }

    function start() {
        if (frame || still() || !onScreen || document.hidden) return;
        last = 0;
        frame = requestAnimationFrame(tick);
    }

    function stop() {
        cancelAnimationFrame(frame);
        frame = 0;
    }

    hoverTarget.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch') return;
        const rect = canvas.getBoundingClientRect();
        target.x = event.clientX - rect.left;
        target.y = event.clientY - rect.top;
        if (bump.amp < 0.01) {
            bump.x = target.x;
            bump.y = target.y;
        }
        target.amp = 0.8;
    });
    hoverTarget.addEventListener('pointerleave', () => { target.amp = 0; });

    new ResizeObserver(() => {
        contours.resize();
        if (!frame) drawOnce();
    }).observe(canvas);

    new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        onScreen ? start() : stop();
    }).observe(canvas);

    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    reduceMotion.addEventListener('change', () => {
        if (still()) { stop(); drawOnce(); } else { start(); }
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        contours.refreshColors();
        if (!frame) drawOnce();
    });

    contours.resize();
    drawOnce();
    start();
}

// A still contour map, used as the picture for a project that has no screenshot yet.
export function drawStillContours(canvas, seed) {
    const contours = createContours(canvas, { seed, cell: 8, scale: 1 / 160, step: 0.06 });
    const render = () => { contours.resize(); contours.draw(seed % 97, null); };
    new ResizeObserver(render).observe(canvas);
}
