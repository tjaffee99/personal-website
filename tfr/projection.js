// Cohort-component population projection (single-year ages 0–100+, annual steps).
// Inputs come from UN WPP 2024 per-location files (see tfr/data/loc/*.json).
(function (root) {
  "use strict";

  const LAST = 2100;

  // Linear interpolation of anchor arrays keyed by year.
  function interpAnchors(anchors, year) {
    const keys = Object.keys(anchors).sort((a, b) => a - b), ys = keys.map(Number);
    if (year <= ys[0]) return anchors[keys[0]];
    if (year >= ys[ys.length - 1]) return anchors[keys[keys.length - 1]];
    let i = 0;
    while (ys[i + 1] < year) i++;
    const y0 = ys[i], y1 = ys[i + 1], w = (year - y0) / (y1 - y0);
    const a = anchors[keys[i]], b = anchors[keys[i + 1]];
    return a.map((v, k) => v + (b[k] - v) * w);
  }

  function unSeries(loc, key, year) {
    const arr = loc.un[key];
    const i = Math.min(Math.max(year - loc.un.y0, 0), arr.length - 1);
    return arr[i];
  }

  // Build the TFR path for 2026..2100 from scenario settings.
  //   mode "un": UN WPP medium path
  //   mode "target": move from startTfr to target linearly by targetYear, then hold
  //   mode "constant": hold startTfr
  function tfrPath(loc, sc) {
    const base = loc.base.year, out = {};
    for (let y = base; y <= LAST; y++) {
      if (sc.mode === "un") out[y] = unSeries(loc, "tfr", y);
      else if (sc.mode === "constant") out[y] = sc.startTfr;
      else {
        const span = Math.max(sc.targetYear - base, 1);
        const w = Math.min(Math.max((y - base) / span, 0), 1);
        out[y] = sc.startTfr + (sc.target - sc.startTfr) * w;
      }
    }
    return out;
  }

  function sum(a) { let s = 0; for (const v of a) s += v; return s; }

  // Same convention as WPP's MedianAgePop (one year below the interpolated completed-age median).
  function medianAge(m, f) {
    const tot = sum(m) + sum(f);
    let acc = 0;
    for (let x = 0; x <= 100; x++) {
      const p = m[x] + f[x];
      if (acc + p >= tot / 2) return x - 1 + (tot / 2 - acc) / p;
      acc += p;
    }
    return 100;
  }

  // scenario: {mode, startTfr, target, targetYear, migMult (0..2), mortality: "un"|"frozen"}
  function project(loc, sc) {
    const base = loc.base.year;
    const tfr = tfrPath(loc, sc);
    const mortYear = (y) => (sc.mortality === "frozen" ? base : y);
    let m = loc.base.m.slice(), f = loc.base.f.slice();
    const years = [];

    const record = (y) => {
      const pm = sum(m), pf = sum(f), tot = pm + pf;
      let kids = 0, work = 0, old = 0;
      for (let x = 0; x <= 100; x++) {
        const p = m[x] + f[x];
        if (x < 15) kids += p; else if (x < 65) work += p; else old += p;
      }
      years.push({
        year: y, pop: tot, m: m.slice(), f: f.slice(), tfr: tfr[y],
        births: null, deaths: null, mig: null, kids, work, old, medAge: medianAge(m, f),
      });
    };

    record(base);
    for (let y = base; y < LAST; y++) {
      const mq = interpAnchors(mapSex(loc.mort, "m"), mortYear(y));
      const fq = interpAnchors(mapSex(loc.mort, "f"), mortYear(y));
      const shape = interpAnchors(loc.asfr, y);
      const srb = unSeries(loc, "srb", y);
      const migAge = interpAnchors(loc.migAge, y + 0.5);

      // age everyone by one year
      const nm = new Array(101).fill(0), nf = new Array(101).fill(0);
      for (let x = 1; x < 100; x++) {
        nm[x] = m[x - 1] * (1 - mq[x]);
        nf[x] = f[x - 1] * (1 - fq[x]);
      }
      nm[100] = (m[99] + m[100]) * (1 - mq[100]);
      nf[100] = (f[99] + f[100]) * (1 - fq[100]);

      // births over the year: ASFR applied to average female exposure at 15..49
      let births = 0;
      for (let x = 15; x <= 49; x++) births += tfr[y] * shape[x - 15] * 0.5 * (f[x] + nf[x]);
      const pMale = srb / (100 + srb);
      nm[0] = births * pMale * (1 - mq[0]);
      nf[0] = births * (1 - pMale) * (1 - fq[0]);
      const deaths = sum(m) + sum(f) + births - sum(nm) - sum(nf);

      // UN-implied net migration by age/sex, scaled; never let a cohort go negative
      let netMig = 0;
      for (let x = 0; x <= 100; x++) {
        const am = migAge[x] * sc.migMult, af = migAge[101 + x] * sc.migMult;
        const m2 = Math.max(nm[x] + am, 0), f2 = Math.max(nf[x] + af, 0);
        netMig += m2 - nm[x] + f2 - nf[x];
        nm[x] = m2; nf[x] = f2;
      }
      Object.assign(years[years.length - 1], { births, deaths, mig: netMig });
      m = nm; f = nf;
      record(y + 1);
    }
    return years;
  }

  const sexCache = new WeakMap();
  function mapSex(mort, sex) {
    let c = sexCache.get(mort);
    if (!c) { c = {}; sexCache.set(mort, c); }
    if (!c[sex]) {
      c[sex] = {};
      for (const y in mort) c[sex][y] = mort[y][sex];
    }
    return c[sex];
  }

  const api = { project, tfrPath, interpAnchors, medianAge, LAST };
  if (typeof module !== "undefined") module.exports = api;
  else root.Projection = api;
})(this);
