/* Fertility Explorer: map + per-country projection UI. Data: UN WPP 2024 (+ latest national TFRs). */
(function () {
  "use strict";

  const DATA = "data/";
  const BASE = 2026, END = 2100;
  const REGION_ORDER = [900, 903, 935, 908, 904, 905, 909];
  const REGION_LABEL = { 900: "World", 903: "Africa", 935: "Asia", 908: "Europe", 904: "Latin America", 905: "Northern America", 909: "Oceania" };
  // world-atlas geometries without a numeric id, or territories folded into their parent
  const GEO_ALIAS = { Kosovo: 412, Somaliland: 706, "N. Cyprus": 196, "248": 246 };

  // Diverging bins around replacement (~2.1): red arm = below, blue arm = above, gray = near replacement.
  const BINS = [1.0, 1.3, 1.6, 1.9, 2.3, 3, 4, 5];
  const BIN_LABELS = ["<1", "1.0", "1.3", "1.6", "1.9", "2.3", "3", "4", "5+"];
  const PAL_LIGHT = ["#8f1d22", "#c8383a", "#e7806b", "#f4bcaa", "#e9e7e1", "#b7d3f6", "#6da7ec", "#2a78d6", "#104281"];
  const PAL_DARK = ["#f2998c", "#d65a51", "#9e3a33", "#5e2722", "#3a3a37", "#1d3a63", "#256abf", "#5598e7", "#a9cdf6"];

  const state = {
    summary: null, byId: new Map(), topo: null,
    mapYear: "latest", selected: null, loc: null, cache: new Map(),
    sc: null, result: null, pyrYear: 2050, compare: "today", pyrGroup: 5, pyrPct: false,
    tableSort: { key: "tfr", dir: 1 },
  };

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const isDark = () => {
    const t = document.documentElement.getAttribute("data-theme");
    if (t) return t === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const palette = () => (isDark() ? PAL_DARK : PAL_LIGHT);
  const colorFor = (v) => (v == null || isNaN(v) ? "var(--nodata)" : palette()[d3.bisectRight(BINS, v)]);

  function fmtPop(n) {
    if (n == null || !isFinite(n)) return "–";
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K";
    return Math.round(n).toString();
  }
  const fmtAxisPop = (n) => (n === 0 ? "0" : fmtPop(n));
  const fmtPct = (v, d = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(d) + "%";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const tip = $("#tip");
  function showTip(html, ev) {
    tip.innerHTML = html;
    tip.style.opacity = 1;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => (tip.style.opacity = 0);

  // keep one-word qualifiers ("provisional") inline; longer caveats go in a hover title
  const shortNote = (l) => (l.note && l.note.length <= 24 ? ` (${l.note})` : "");
  const unAt = (loc, key, year) => {
    const a = loc.un[key], i = year - loc.un.y0;
    return i >= 0 && i < a.length ? a[i] : null;
  };
  const sumTfrAt = (s, year) => s.tfr[year - state.summary.y0];

  function mapValue(s) {
    if (state.mapYear === "latest") {
      if (s.latest) return { v: s.latest.tfr, label: `${s.latest.year} reported${shortNote(s.latest)}`, src: s.latest.source };
      return { v: sumTfrAt(s, BASE), label: `${BASE} estimate`, src: "UN WPP 2024" };
    }
    const y = state.mapYear;
    return { v: sumTfrAt(s, y), label: `${y} ${y <= 2023 ? "estimate" : "projection (medium)"}`, src: "UN WPP 2024" };
  }

  /* ---------- URL hash state ---------- */
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const o = {};
    for (const [k, v] of p) o[k] = v;
    return o;
  }
  let hashTimer = null;
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      if (!state.loc) return;
      const sc = state.sc, p = new URLSearchParams();
      p.set("loc", state.loc.id);
      if (sc.mode !== "un") p.set("mode", sc.mode);
      if (sc.mode === "custom") { p.set("tfr", sc.target.toFixed(2)); p.set("by", sc.targetYear); }
      if (sc.migMult !== 1) p.set("mig", Math.round(sc.migMult * 100));
      if (sc.mortality !== "un") p.set("mort", "frozen");
      p.set("y", state.pyrYear);
      history.replaceState(null, "", "#" + p.toString());
    }, 250);
  }

  /* ---------- map ---------- */
  let mapSvg, mapG, mapPaths, zoom, projection, pathGen;

  function buildMap() {
    const el = $("#map");
    el.querySelector(".loading")?.remove();
    const W = 960, H = 480;
    projection = d3.geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], { type: "Sphere" });
    pathGen = d3.geoPath(projection);
    mapSvg = d3.select(el).insert("svg", ".zoom-ctl").attr("viewBox", `0 0 ${W} ${H}`)
      .attr("role", "img").attr("aria-label", "World map colored by total fertility rate. Click a country to explore it.");
    mapG = mapSvg.append("g");
    mapG.append("path").attr("class", "sphere").attr("d", pathGen({ type: "Sphere" }));

    const feats = topojson.feature(state.topo, state.topo.objects.countries).features
      .filter((f) => f.properties.name !== "Antarctica");
    for (const f of feats) {
      const raw = f.id;
      f.locId = GEO_ALIAS[f.properties.name] || GEO_ALIAS[raw] || (raw != null ? +raw : null);
    }
    mapPaths = mapG.selectAll("path.country").data(feats).join("path")
      .attr("class", "country").attr("d", pathGen)
      .on("mousemove", (ev, f) => {
        const s = state.byId.get(f.locId);
        if (!s) return showTip(`<div class="t">${esc(f.properties.name)}</div><div class="m">No data</div>`, ev);
        const mv = mapValue(s);
        showTip(`<div class="t">${esc(s.name)}</div>
          <div class="r"><span><i style="background:${colorFor(mv.v)}"></i>TFR</span><b>${mv.v != null ? mv.v.toFixed(2) : "–"}</b></div>
          <div class="r"><span>Population ${BASE}</span><span>${fmtPop(s.pop)}</span></div>
          <div class="m">${esc(mv.label)} · ${esc(mv.src)}</div>`, ev);
      })
      .on("mouseleave", hideTip)
      .on("click", (ev, f) => { if (state.byId.has(f.locId)) selectLoc(f.locId, true); });

    zoom = d3.zoom().scaleExtent([1, 14]).translateExtent([[0, 0], [W, H]])
      .on("zoom", (ev) => mapG.attr("transform", ev.transform));
    mapSvg.call(zoom).on("dblclick.zoom", null);
    $("#zin").onclick = () => mapSvg.transition().duration(250).call(zoom.scaleBy, 1.6);
    $("#zout").onclick = () => mapSvg.transition().duration(250).call(zoom.scaleBy, 1 / 1.6);
    colorMap();
  }

  function colorMap() {
    if (!mapPaths) return;
    mapPaths.attr("fill", (f) => {
      const s = state.byId.get(f.locId);
      return s ? colorFor(mapValue(s).v) : "var(--nodata)";
    }).classed("selected", (f) => state.loc && f.locId === state.loc.id);
    mapPaths.filter(".selected").raise();
    const when = state.mapYear === "latest" ? "· latest reported (UN 2026 estimate where none)" :
      `· ${state.mapYear} ${state.mapYear <= 2023 ? "(UN estimate)" : "(UN medium projection)"}`;
    $("#map-when").textContent = when;
    $("#map-year-lbl").textContent = state.mapYear === "latest" ? "Latest" : state.mapYear;
    $("#latest-btn").setAttribute("aria-pressed", state.mapYear === "latest");
    renderLegend();
    if ($("#table-view").style.display === "block") renderTable();
  }

  function renderLegend() {
    const pal = palette();
    $("#legend").innerHTML = pal.map((c, i) =>
      `<div class="bin"><div class="sw" style="background:${c}"></div><span>${BIN_LABELS[i]}</span></div>`).join("") +
      `<div class="cap">children per woman<br>red: below replacement</div>`;
  }

  function setupMapControls() {
    const yr = $("#map-year");
    yr.addEventListener("input", () => { state.mapYear = +yr.value; colorMap(); });
    $("#latest-btn").onclick = () => { state.mapYear = "latest"; yr.value = BASE; colorMap(); };
    let timer = null;
    const play = $("#map-play");
    play.onclick = () => {
      if (timer) { clearInterval(timer); timer = null; play.textContent = "▶"; return; }
      let y = state.mapYear === "latest" || state.mapYear >= 2100 ? 1950 : state.mapYear;
      play.textContent = "❚❚";
      timer = setInterval(() => {
        state.mapYear = y; yr.value = y; colorMap();
        y += 1;
        if (y > 2100) { clearInterval(timer); timer = null; play.textContent = "▶"; }
      }, 90);
    };
    $("#view-map").onclick = () => setView("map");
    $("#view-table").onclick = () => setView("table");

    const dl = $("#loc-list");
    const sorted = [...state.summary.locs].sort((a, b) => a.name.localeCompare(b.name));
    dl.innerHTML = sorted.map((s) => `<option value="${esc(s.name)}"></option>`).join("");
    const search = $("#search");
    const go = () => {
      const q = search.value.trim().toLowerCase();
      if (!q) return;
      const hit = sorted.find((s) => s.name.toLowerCase() === q) || sorted.find((s) => s.name.toLowerCase().startsWith(q)) ||
        sorted.find((s) => s.name.toLowerCase().includes(q));
      if (hit) { selectLoc(hit.id, true); search.value = ""; search.blur(); }
    };
    search.addEventListener("change", go);
    search.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });

    $("#regions").innerHTML = REGION_ORDER.map((id) =>
      `<button type="button" class="btn" data-id="${id}">${REGION_LABEL[id]}</button>`).join("");
    $("#regions").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (b) selectLoc(+b.dataset.id, true);
    });
  }

  function setView(v) {
    $("#view-map").setAttribute("aria-pressed", v === "map");
    $("#view-table").setAttribute("aria-pressed", v === "table");
    $("#map").style.display = v === "map" ? "" : "none";
    $("#table-view").style.display = v === "table" ? "block" : "none";
    if (v === "table") renderTable();
  }

  function renderTable() {
    const { key, dir } = state.tableSort;
    const rows = state.summary.locs.filter((s) => !s.region).map((s) => {
      const mv = mapValue(s);
      return { id: s.id, name: s.name, tfr: mv.v, label: mv.label, src: mv.src, pop: s.pop };
    });
    rows.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * dir;
    });
    const th = (k, l, cls = "") => `<th class="${cls}" data-k="${k}">${l}${key === k ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`;
    $("#table-view").innerHTML = `<table><thead><tr>${th("name", "Country")}${th("tfr", "TFR", "num")}<th>Year · source</th>${th("pop", "Population " + BASE, "num")}</tr></thead><tbody>` +
      rows.map((r) => `<tr data-id="${r.id}"><td>${esc(r.name)}</td><td class="num"><span class="chip" style="background:${colorFor(r.tfr)}"></span>${r.tfr != null ? r.tfr.toFixed(2) : "–"}</td><td>${esc(r.label)} · ${esc(r.src)}</td><td class="num">${fmtPop(r.pop)}</td></tr>`).join("") +
      `</tbody></table>`;
    $("#table-view thead").onclick = (e) => {
      const k = e.target.closest("th")?.dataset.k;
      if (!k) return;
      state.tableSort = { key: k, dir: state.tableSort.key === k ? -state.tableSort.dir : 1 };
      renderTable();
    };
    $("#table-view tbody").onclick = (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr) selectLoc(+tr.dataset.id, true);
    };
  }

  /* ---------- selection & scenario ---------- */
  async function loadLoc(id) {
    if (!state.cache.has(id)) {
      state.cache.set(id, fetch(`${DATA}loc/${id}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }));
    }
    return state.cache.get(id);
  }

  function startTfr(loc) {
    const s = state.byId.get(loc.id);
    return s && s.latest ? s.latest.tfr : unAt(loc, "tfr", BASE);
  }

  async function selectLoc(id, scroll, fromHash) {
    let loc;
    try { loc = await loadLoc(id); } catch (e) {
      $("#panel").innerHTML = `<div class="loading">Couldn't load data for this location.</div>`;
      return;
    }
    state.loc = loc;
    const st = startTfr(loc);
    const h = fromHash || {};
    state.sc = {
      mode: h.mode === "custom" || h.mode === "constant" ? h.mode : "un",
      startTfr: st,
      target: h.tfr ? Math.min(7, Math.max(0.5, +h.tfr)) : Math.round(st * 20) / 20,
      targetYear: h.by ? Math.min(END, Math.max(BASE + 1, +h.by)) : 2050,
      migMult: h.mig != null ? Math.min(2, Math.max(0, +h.mig / 100)) : 1,
      mortality: h.mort === "frozen" ? "frozen" : "un",
    };
    if (h.y) state.pyrYear = Math.min(END, Math.max(1950, +h.y));
    colorMap();
    buildPanel();
    update();
    if (scroll) $("#panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function buildPanel() {
    const loc = state.loc, s = state.byId.get(loc.id), sc = state.sc;
    const latest = s.latest;
    const unNow = unAt(loc, "tfr", BASE);
    const tfrFact = latest
      ? `TFR <b>${latest.tfr.toFixed(2)}</b> in ${latest.year}${esc(shortNote(latest))} · <a href="${esc(latest.url)}" target="_blank" rel="noopener" title="${esc(latest.note || "")}">${esc(latest.source)}</a>${latest.note && !shortNote(latest) ? ` <span title="${esc(latest.note)}" style="cursor:help">ⓘ</span>` : ""} · UN est. ${BASE}: ${unNow.toFixed(2)}`
      : `TFR <b>${unNow.toFixed(2)}</b> (UN estimate, ${BASE})`;
    const migAvg = d3.mean(d3.range(BASE, 2051), (y) => unAt(loc, "mig", y));

    $("#panel").innerHTML = `
      <div class="panel-head"><h2>${esc(loc.name)}</h2>
        <div class="facts">${tfrFact} · Population <b>${fmtPop(loc.un.pop[BASE - loc.un.y0])}</b></div></div>
      <div class="layout">
        <aside class="card controls" aria-label="Scenario controls">
          <h2>Your scenario</h2>
          <p class="sub">Change future fertility and see the population respond.</p>
          <div class="ctl">
            <label class="lbl">Fertility path</label>
            <div class="seg" role="group" id="mode">
              <button type="button" data-m="un">UN medium</button>
              <button type="button" data-m="custom">Custom</button>
              <button type="button" data-m="constant">Hold today</button>
            </div>
            <div class="hint" id="mode-hint"></div>
          </div>
          <div class="ctl" id="ctl-target">
            <label class="lbl" for="target">Future TFR <output id="target-out"></output></label>
            <input type="range" id="target" min="0.5" max="7" step="0.05">
            <div class="presets" id="presets">
              ${[0.8, 1.2, 1.6, 2.1, 3].map((v) => `<button type="button" class="btn" data-v="${v}">${v === 2.1 ? "2.1 replacement" : v}</button>`).join("")}
            </div>
          </div>
          <div class="ctl" id="ctl-year">
            <label class="lbl" for="tyear">Reached by <output id="tyear-out"></output></label>
            <input type="range" id="tyear" min="${BASE + 1}" max="${END}" step="1">
            <div class="hint">Fertility moves in a straight line from today's ${sc.startTfr.toFixed(2)} to your target, then holds. You can also drag the handle on the fertility chart.</div>
          </div>
          <hr class="sep">
          <div class="ctl">
            <label class="lbl" for="mig">Migration <output id="mig-out"></output></label>
            <input type="range" id="mig" min="0" max="2" step="0.1">
            <div class="hint" id="mig-hint">Share of the UN's assumed migration (avg ${migAvg >= 0 ? "+" : "−"}${fmtPop(Math.abs(migAvg))}/yr net, 2026–2050).</div>
          </div>
          <div class="ctl">
            <label class="check"><input type="checkbox" id="mort"> Life expectancy keeps rising as the UN projects (unchecked: frozen at ${BASE} levels)</label>
          </div>
          <button type="button" class="btn" id="reset">Reset to UN medium</button>
        </aside>
        <div>
          <div class="tiles" id="tiles"></div>
          <div class="charts">
            <div class="card wide">
              <div class="pyr-head">
                <div><h2>Population pyramid</h2><p class="sub" id="pyr-sub"></p></div>
                <div class="toolbar">
                  <label class="sub" style="margin:0">Outline <select id="compare">
                    <option value="today">${BASE} (today)</option>
                    <option value="un">UN medium, same year</option>
                    <option value="2000">2000</option><option value="1975">1975</option><option value="1950">1950</option>
                    <option value="none">None</option></select></label>
                  <div class="seg" role="group" id="pyr-group"><button type="button" data-g="5">5-yr</button><button type="button" data-g="1">1-yr</button></div>
                  <div class="seg" role="group" id="pyr-pct"><button type="button" data-p="0">People</button><button type="button" data-p="1">% of total</button></div>
                </div>
              </div>
              <div class="pyr-year">
                <button type="button" class="btn" id="pyr-play" aria-label="Play">▶</button>
                <input type="range" id="pyr-year" min="1950" max="${END}" step="1" aria-label="Pyramid year">
                <span class="yr" id="pyr-year-lbl"></span>
              </div>
              <div class="chart-legend" id="pyr-legend"></div>
              <div class="chart" id="pyramid"></div>
            </div>
            <div class="card"><h2>Fertility rate</h2><p class="sub">Children per woman</p><div class="chart" id="c-tfr"></div></div>
            <div class="card"><h2>Total population</h2><p class="sub">Shaded: UN 95% prediction interval</p><div class="chart" id="c-pop"></div></div>
            <div class="card"><h2>Births and deaths</h2><p class="sub">Per year</p><div class="chart" id="c-bd"></div></div>
            <div class="card"><h2>Age structure</h2><p class="sub">Share of population</p><div class="chart" id="c-age"></div></div>
            <div class="card"><h2>Median age</h2><p class="sub">Years</p><div class="chart" id="c-med"></div></div>
            <div class="card"><h2>Old-age dependency</h2><p class="sub">People 65+ per 100 aged 15–64</p><div class="chart" id="c-dep"></div></div>
          </div>
        </div>
      </div>`;

    // wire controls
    $("#mode").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-m]");
      if (!b) return;
      sc.mode = b.dataset.m;
      update();
    });
    const target = $("#target"), tyear = $("#tyear"), mig = $("#mig"), mort = $("#mort");
    target.addEventListener("input", () => { sc.target = +target.value; sc.mode = "custom"; update(); });
    tyear.addEventListener("input", () => { sc.targetYear = +tyear.value; sc.mode = "custom"; update(); });
    $("#presets").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (b) { sc.target = +b.dataset.v; sc.mode = "custom"; update(); }
    });
    mig.addEventListener("input", () => { sc.migMult = +mig.value; update(); });
    mort.addEventListener("change", () => { sc.mortality = mort.checked ? "un" : "frozen"; update(); });
    $("#reset").onclick = () => {
      Object.assign(sc, { mode: "un", target: Math.round(sc.startTfr * 20) / 20, targetYear: 2050, migMult: 1, mortality: "un" });
      update();
    };

    const py = $("#pyr-year");
    py.value = state.pyrYear;
    py.addEventListener("input", () => setPyrYear(+py.value));
    let timer = null;
    const play = $("#pyr-play");
    play.onclick = () => {
      if (timer) { clearInterval(timer); timer = null; play.textContent = "▶"; return; }
      let y = state.pyrYear >= END ? 1950 : state.pyrYear;
      play.textContent = "❚❚";
      timer = setInterval(() => {
        setPyrYear(y);
        y += y < BASE ? 5 : 1;
        if (y > END) { clearInterval(timer); timer = null; play.textContent = "▶"; }
      }, 110);
    };
    $("#compare").value = state.compare;
    $("#compare").onchange = (e) => { state.compare = e.target.value; drawPyramid(); };
    $("#pyr-group").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-g]");
      if (b) { state.pyrGroup = +b.dataset.g; drawPyramid(); }
    });
    $("#pyr-pct").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-p]");
      if (b) { state.pyrPct = b.dataset.p === "1"; drawPyramid(); }
    });
  }

  function syncControls() {
    const sc = state.sc;
    for (const b of document.querySelectorAll("#mode button")) b.setAttribute("aria-pressed", b.dataset.m === sc.mode);
    $("#target").value = sc.target;
    $("#target-out").textContent = sc.target.toFixed(2);
    $("#tyear").value = sc.targetYear;
    $("#tyear-out").textContent = sc.targetYear;
    $("#mig").value = sc.migMult;
    $("#mig-out").textContent = Math.round(sc.migMult * 100) + "%";
    $("#mort").checked = sc.mortality === "un";
    $("#ctl-target").classList.toggle("disabled", sc.mode !== "custom");
    $("#ctl-year").classList.toggle("disabled", sc.mode !== "custom");
    const unEnd = unAt(state.loc, "tfr", END);
    $("#mode-hint").textContent = sc.mode === "un"
      ? `UN assumes TFR goes from ${unAt(state.loc, "tfr", BASE).toFixed(2)} now to ${unEnd.toFixed(2)} by 2100.`
      : sc.mode === "constant" ? `Fertility stays at ${sc.startTfr.toFixed(2)} forever.`
        : `From ${sc.startTfr.toFixed(2)} to ${sc.target.toFixed(2)} by ${sc.targetYear}.`;
  }

  function update() {
    const sc = state.sc;
    state.result = Projection.project(state.loc, sc);
    state.resByYear = new Map(state.result.map((d) => [d.year, d]));
    syncControls();
    drawTiles();
    drawPyramid();
    drawTimeCharts();
    writeHash();
  }

  function setPyrYear(y) {
    state.pyrYear = y;
    const py = $("#pyr-year");
    if (py && +py.value !== y) py.value = y;
    drawPyramid();
    drawYearMarkers();
    writeHash();
  }

  /* ---------- derived series ---------- */
  function histPyr(loc, year) {
    const p = loc.pyr[year];
    return p ? { m: p.m.map((v) => v * p.s), f: p.f.map((v) => v * p.s), year } : null;
  }
  const histYears = (loc) => Object.keys(loc.pyr).map(Number).sort((a, b) => a - b);

  function pyramidFor(year) {
    const loc = state.loc;
    if (year >= BASE) { const d = state.resByYear.get(year); return { m: d.m, f: d.f, year, kind: "scenario" }; }
    const ys = histYears(loc).filter((y) => y < BASE);
    const near = ys.reduce((a, b) => (Math.abs(b - year) < Math.abs(a - year) ? b : a));
    return { ...histPyr(loc, near), kind: "history" };
  }
  function unPyramid(year) {
    const loc = state.loc, ys = histYears(loc);
    const near = ys.reduce((a, b) => (Math.abs(b - year) < Math.abs(a - year) ? b : a));
    return histPyr(loc, near);
  }

  function ageShares(m, f) {
    let k = 0, w = 0, o = 0;
    for (let x = 0; x <= 100; x++) { const p = m[x] + f[x]; if (x < 15) k += p; else if (x < 65) w += p; else o += p; }
    const t = k + w + o;
    return { kids: k / t, work: w / t, old: o / t, dep: (o / w) * 100 };
  }

  /* ---------- tiles ---------- */
  function drawTiles() {
    const loc = state.loc, res = state.result;
    const now = res[0], end = res[res.length - 1];
    const unEnd = unAt(loc, "pop", END);
    const hist = d3.range(1950, BASE).map((y) => ({ year: y, pop: unAt(loc, "pop", y) }));
    const all = hist.concat(res.map((d) => ({ year: d.year, pop: d.pop })));
    const peak = all.reduce((a, b) => (b.pop > a.pop ? b : a));
    const chg = end.pop / now.pop - 1;
    let peakTxt, peakSub;
    if (peak.year < BASE) { peakTxt = fmtPop(peak.pop); peakSub = `Already peaked in ${peak.year}`; }
    else if (peak.year >= END) { peakTxt = "Not yet"; peakSub = `still growing in ${END}`; }
    else { peakTxt = fmtPop(peak.pop); peakSub = `in ${peak.year}`; }
    const s0 = ageShares(now.m, now.f), s1 = ageShares(end.m, end.f);
    const tiles = [
      { k: `Population ${BASE}`, v: fmtPop(now.pop), d: `${fmtPop(now.births)} births/yr` },
      { k: `Population ${END}`, v: fmtPop(end.pop), d: `${fmtPct(chg)} vs today · UN: ${fmtPop(unEnd)}` },
      { k: "Peak population", v: peakTxt, d: peakSub },
      { k: `Aged 65+ in ${END}`, v: (s1.old * 100).toFixed(0) + "%", d: `today ${(s0.old * 100).toFixed(0)}% · median age ${end.medAge.toFixed(0)}` },
    ];
    $("#tiles").innerHTML = tiles.map((t) => `<div class="card tile"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="d">${t.d}</div></div>`).join("");
  }

  /* ---------- pyramid ---------- */
  function group(arr, g) {
    if (g === 1) return arr.map((v, x) => ({ a0: x, a1: x, v }));
    const out = [];
    for (let a = 0; a < 100; a += 5) out.push({ a0: a, a1: a + 4, v: d3.sum(arr.slice(a, a + 5)) });
    out.push({ a0: 100, a1: 100, v: arr[100] });
    return out;
  }
  const ageLabel = (b) => (b.a0 === 100 ? "100+" : b.a0 === b.a1 ? `${b.a0}` : `${b.a0}–${b.a1}`);

  function drawPyramid() {
    const el = $("#pyramid");
    if (!el || !state.result) return;
    const year = state.pyrYear, g = state.pyrGroup, pct = state.pyrPct;
    const cur = pyramidFor(year);
    let cmp = null, cmpLabel = "";
    if (state.compare === "today") { const d = state.result[0]; cmp = { m: d.m, f: d.f }; cmpLabel = `${BASE}`; }
    else if (state.compare === "un") { cmp = unPyramid(year); cmpLabel = `UN medium ${cmp.year}`; }
    else if (state.compare !== "none") { cmp = histPyr(state.loc, +state.compare); cmpLabel = state.compare; }

    const tot = (p) => d3.sum(p.m) + d3.sum(p.f);
    const norm = (p) => { const t = tot(p); return { m: p.m.map((v) => (pct ? v / t : v)), f: p.f.map((v) => (pct ? v / t : v)) }; };
    const C = norm(cur), K = cmp ? norm(cmp) : null;
    const gm = group(C.m, g), gf = group(C.f, g);
    const km = K && group(K.m, g), kf = K && group(K.f, g);

    // fixed scale across the whole scenario so playback shows growth/shrinkage honestly
    let max = 0;
    const scan = (m, f) => {
      const t = pct ? d3.sum(m) + d3.sum(f) : 1;
      for (const arr of [m, f]) for (const b of group(arr, g)) max = Math.max(max, b.v / t);
    };
    // (in % mode the question is shape, so scale to what's on screen instead)
    if (pct) { scan(cur.m, cur.f); if (cmp) scan(cmp.m, cmp.f); }
    else {
      for (const d of state.result) if (d.year % 5 === 1 || d.year === BASE) scan(d.m, d.f);
      for (const y of histYears(state.loc)) { const h = histPyr(state.loc, y); scan(h.m, h.f); }
    }
    max *= 1.04;

    const W = el.clientWidth || 700, H = Math.max(360, Math.min(520, W * 0.62));
    const mid = 40, M = { t: 18, r: 8, b: 26, l: 8 };
    const half = (W - M.l - M.r - mid) / 2;
    const xL = d3.scaleLinear().domain([0, max]).range([M.l + half, M.l]);
    const xR = d3.scaleLinear().domain([0, max]).range([M.l + half + mid, W - M.r]);
    const n = gm.length;
    const y = d3.scaleBand().domain(d3.range(n)).range([H - M.b, M.t]).paddingInner(g === 5 ? 0.12 : 0.04);

    d3.select(el).selectAll("*").remove();
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("height", H)
      .attr("role", "img").attr("aria-label", `Population pyramid for ${state.loc.name}, ${cur.year}`);

    const nTicks = Math.max(2, Math.floor(half / 70));
    const ticks = xR.ticks(nTicks);
    const fmtX = pct ? xR.tickFormat(nTicks, "%") : fmtAxisPop;
    const gridG = svg.append("g").attr("class", "grid");
    for (const t of ticks) {
      for (const sc of [xL, xR]) gridG.append("line").attr("x1", sc(t)).attr("x2", sc(t)).attr("y1", M.t).attr("y2", H - M.b);
    }
    const ax = svg.append("g").attr("class", "axis");
    for (const t of ticks) {
      for (const sc of [xL, xR]) ax.append("text").attr("x", sc(t)).attr("y", H - M.b + 16).attr("text-anchor", "middle").text(fmtX(t));
    }
    // age labels in the middle gutter
    const step = g === 5 ? 2 : 10;
    gm.forEach((b, i) => {
      if (b.a0 % (step * (g === 5 ? 5 : 1)) === 0 || b.a0 === 100) {
        ax.append("text").attr("x", M.l + half + mid / 2).attr("y", y(i) + y.bandwidth() / 2 + 4).attr("text-anchor", "middle")
          .text(b.a0 === 100 ? "100+" : b.a0);
      }
    });

    const rr = g === 5 ? 2 : 0;
    svg.append("g").selectAll("rect").data(gm).join("rect")
      .attr("x", (b) => xL(b.v)).attr("width", (b) => xL(0) - xL(b.v)).attr("y", (b, i) => y(i)).attr("height", y.bandwidth())
      .attr("rx", rr).style("fill", "var(--male)");
    svg.append("g").selectAll("rect").data(gf).join("rect")
      .attr("x", xR(0)).attr("width", (b) => xR(b.v) - xR(0)).attr("y", (b, i) => y(i)).attr("height", y.bandwidth())
      .attr("rx", rr).style("fill", "var(--female)");

    if (K) {
      const outline = (bins, sc) => {
        let d = "";
        bins.forEach((b, i) => {
          const y0 = y(i) + y.bandwidth() + (y.step() - y.bandwidth()) / 2, y1 = y(i) - (y.step() - y.bandwidth()) / 2;
          d += `${i ? "L" : "M"}${sc(b.v)},${y0}L${sc(b.v)},${y1}`;
        });
        return d;
      };
      svg.append("path").attr("d", outline(km, xL)).attr("fill", "none").style("stroke", "var(--ink)").attr("stroke-width", 1.5).attr("stroke-linejoin", "round");
      svg.append("path").attr("d", outline(kf, xR)).attr("fill", "none").style("stroke", "var(--ink)").attr("stroke-width", 1.5).attr("stroke-linejoin", "round");
    }

    svg.append("text").attr("class", "lbl-direct").attr("x", M.l).attr("y", 10).text("Men");
    svg.append("text").attr("class", "lbl-direct").attr("x", W - M.r).attr("y", 10).attr("text-anchor", "end").text("Women");

    // hover rows
    const fmtV = pct ? (v) => (v * 100).toFixed(2) + "%" : (v) => fmtPop(v);
    svg.append("g").selectAll("rect").data(gm).join("rect")
      .attr("x", 0).attr("width", W).attr("y", (b, i) => y(i) - (y.step() - y.bandwidth()) / 2).attr("height", y.step())
      .attr("fill", "transparent")
      .on("mousemove", (ev, b) => {
        const i = gm.indexOf(b);
        let html = `<div class="t">Age ${ageLabel(b)} · ${cur.year}</div>
          <div class="r"><span><i style="background:var(--male)"></i>Men</span><b>${fmtV(b.v)}</b></div>
          <div class="r"><span><i style="background:var(--female)"></i>Women</span><b>${fmtV(gf[i].v)}</b></div>`;
        if (K) html += `<div class="r"><span>${cmpLabel} men / women</span><span>${fmtV(km[i].v)} / ${fmtV(kf[i].v)}</span></div>`;
        showTip(html, ev);
      })
      .on("mouseleave", hideTip);

    for (const b of document.querySelectorAll("#pyr-group button")) b.setAttribute("aria-pressed", +b.dataset.g === g);
    for (const b of document.querySelectorAll("#pyr-pct button")) b.setAttribute("aria-pressed", (b.dataset.p === "1") === pct);
    $("#pyr-year-lbl").textContent = cur.year;
    const kind = cur.kind === "history" ? "UN estimate" : year === BASE ? "UN estimate (start of projection)" : "your scenario";
    $("#pyr-sub").textContent = `${cur.year} · ${kind} · total ${fmtPop(tot(cur))}`;
    $("#pyr-legend").innerHTML =
      `<span class="it"><span class="bx" style="background:var(--male)"></span>Men ${cur.year}</span>` +
      `<span class="it"><span class="bx" style="background:var(--female)"></span>Women ${cur.year}</span>` +
      (K ? `<span class="it"><span class="ln" style="border-color:var(--ink)"></span>${cmpLabel}</span>` : "");
  }

  /* ---------- time charts ---------- */
  const charts = {};

  function lineChart(el, o) {
    const W = el.clientWidth || 420, H = o.height || 230;
    const M = { t: 10, r: o.rightPad || 44, b: 24, l: 44 };
    d3.select(el).selectAll("*").remove();
    const legend = d3.select(el).append("div").attr("class", "chart-legend");
    for (const s of o.series.filter((s) => s.legend !== false)) {
      const it = legend.append("span").attr("class", "it");
      if (s.area) it.append("span").attr("class", "bx").style("background", s.color);
      else it.append("span").attr("class", "ln" + (s.dash ? " dash" : "")).style("border-color", s.color);
      it.append("span").text(s.label);
    }
    if (o.band) {
      const it = legend.append("span").attr("class", "it");
      it.append("span").attr("class", "bx").style("background", "var(--band)").style("outline", "1px solid var(--axis)");
      it.append("span").text(o.band.label);
    }
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("height", H);
    const x = d3.scaleLinear().domain([1950, END]).range([M.l, W - M.r]);
    let ymax = 0, ymin = Infinity;
    for (const s of o.series) for (const p of s.points) if (p[1] != null) { ymax = Math.max(ymax, p[1]); ymin = Math.min(ymin, p[1]); }
    if (o.band) for (const p of o.band.points) { ymax = Math.max(ymax, p[2]); ymin = Math.min(ymin, p[1]); }
    for (const h of o.hlines || []) ymax = Math.max(ymax, h.y);
    const y = d3.scaleLinear().domain(o.yDomain || [o.zero === false ? ymin * 0.95 : 0, ymax * 1.06]).nice().range([H - M.b, M.t]);

    svg.append("g").attr("class", "grid").attr("transform", `translate(${M.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-(W - M.l - M.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6).tickFormat(o.yFmt)).call((g) => g.select(".domain").remove());
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b})`)
      .call(d3.axisBottom(x).tickValues([1950, 1975, 2000, 2025, 2050, 2075, 2100]).tickFormat(d3.format("d")).tickSize(4));

    // projection divider
    svg.append("line").attr("x1", x(BASE)).attr("x2", x(BASE)).attr("y1", M.t).attr("y2", H - M.b).style("stroke", "var(--axis)");
    svg.append("text").attr("class", "annot").attr("x", x(BASE) + 4).attr("y", M.t + 9).text("projection →");

    for (const h of o.hlines || []) {
      svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(h.y)).attr("y2", y(h.y)).style("stroke", "var(--muted)").attr("stroke-width", 1);
      svg.append("text").attr("class", "annot").attr("x", M.l + 4).attr("y", y(h.y) - 4).text(h.label);
    }
    if (o.band) {
      svg.append("path").datum(o.band.points).style("fill", "var(--band)")
        .attr("d", d3.area().x((p) => x(p[0])).y0((p) => y(p[1])).y1((p) => y(p[2])));
    }
    if (o.stack) o.stack(svg, x, y);
    for (const s of o.series) {
      if (s.area) continue;
      svg.append("path").datum(s.points.filter((p) => p[1] != null)).attr("fill", "none").style("stroke", s.color)
        .attr("stroke-width", s.width || 2).attr("stroke-dasharray", s.dash ? "4 3" : null).attr("stroke-linejoin", "round")
        .attr("d", d3.line().x((p) => x(p[0])).y((p) => y(p[1])));
      if (s.endLabel) {
        const last = s.points.filter((p) => p[1] != null).at(-1);
        if (last) svg.append("text").attr("class", "lbl-direct").attr("x", x(last[0]) + 4).attr("y", y(last[1]) + 4).text(s.endLabel(last[1]));
      }
    }
    for (const pt of o.points || []) {
      svg.append("circle").attr("cx", x(pt.x)).attr("cy", y(pt.y)).attr("r", 4.5).style("fill", pt.color).style("stroke", "var(--surface)").attr("stroke-width", 2);
      if (pt.label) svg.append("text").attr("class", "lbl-direct").attr("x", x(pt.x) - 6).attr("y", y(pt.y) - 8).attr("text-anchor", "end").text(pt.label);
    }

    // year marker (synced with pyramid)
    const marker = svg.append("line").attr("class", "year-marker").attr("y1", M.t).attr("y2", H - M.b)
      .style("stroke", "var(--ink)").attr("stroke-width", 1).attr("opacity", 0.35);

    // crosshair + tooltip
    const cross = svg.append("line").attr("y1", M.t).attr("y2", H - M.b).style("stroke", "var(--ink-2)").attr("opacity", 0);
    const dots = svg.append("g");
    const lookup = o.series.map((s) => new Map(s.points.map((p) => [p[0], p[1]])));
    const bandMap = o.band ? new Map(o.band.points.map((p) => [p[0], p])) : null;
    svg.append("rect").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b)
      .attr("fill", "transparent").style("cursor", "crosshair")
      .on("mousemove", (ev) => {
        const [mx] = d3.pointer(ev);
        const yr = Math.round(x.invert(mx));
        cross.attr("x1", x(yr)).attr("x2", x(yr)).attr("opacity", 0.6);
        dots.selectAll("*").remove();
        let html = `<div class="t">${yr}</div>`;
        o.series.forEach((s, i) => {
          const v = lookup[i].get(yr);
          if (v == null) return;
          if (!s.area) dots.append("circle").attr("cx", x(yr)).attr("cy", y(v)).attr("r", 3.5).style("fill", s.color).style("stroke", "var(--surface)").attr("stroke-width", 2);
          html += `<div class="r"><span><i style="background:${s.color}"></i>${s.label}</span><b>${(s.tipFmt || o.tipFmt)(v)}</b></div>`;
        });
        if (bandMap && bandMap.get(yr)) { const b = bandMap.get(yr); html += `<div class="m">UN 95% range: ${o.tipFmt(b[1])} – ${o.tipFmt(b[2])}</div>`; }
        if (yr >= BASE) html += `<div class="m">Click to show this year in the pyramid</div>`;
        showTip(html, ev);
      })
      .on("mouseleave", () => { cross.attr("opacity", 0); dots.selectAll("*").remove(); hideTip(); })
      .on("click", (ev) => {
        const yr = Math.round(x.invert(d3.pointer(ev)[0]));
        setPyrYear(Math.max(1950, Math.min(END, yr)));
      });

    if (o.handle) {
      const h = o.handle;
      const hg = svg.append("g").attr("class", "handle");
      hg.append("circle").attr("r", 14).attr("fill", "transparent");
      hg.append("circle").attr("r", 6).style("fill", "var(--scenario)").style("stroke", "var(--surface)").attr("stroke-width", 2);
      hg.attr("transform", `translate(${x(h.x)},${y(h.y)})`);
      hg.append("title").text("Drag to set target fertility and year");
      // Redraws replace this element mid-gesture, so track the pointer on the window and
      // resolve it against whichever chart is live at each move.
      hg.on("pointerdown", (ev) => {
        ev.preventDefault();
        hideTip();
        const move = (e) => {
          const svgEl = el.querySelector("svg");
          const c = el._chart;
          if (!svgEl || !c) return;
          const r = svgEl.getBoundingClientRect(), k = c.W / r.width;
          const nx = Math.round(Math.max(BASE + 1, Math.min(END, c.x.invert((e.clientX - r.left) * k))));
          const ny = Math.round(Math.max(0.5, Math.min(7, c.y.invert((e.clientY - r.top) * k))) * 20) / 20;
          h.onDrag(nx, ny);
        };
        const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      hg.style("touch-action", "none");
    }
    el._chart = { x, y, marker, M, H, W };
    return el._chart;
  }

  function drawYearMarkers() {
    for (const k in charts) {
      const c = charts[k];
      if (!c) continue;
      c.marker.attr("x1", c.x(state.pyrYear)).attr("x2", c.x(state.pyrYear));
    }
  }

  function drawTimeCharts() {
    const loc = state.loc, res = state.result, sc = state.sc;
    const s = state.byId.get(loc.id);
    const hist = (key, to = BASE, from = 1950) => d3.range(from, to + 1).map((y) => [y, unAt(loc, key, y)]);
    const unFut = (key) => d3.range(BASE, END + 1).map((y) => [y, unAt(loc, key, y)]);
    const scen = (fn) => res.map((d) => [d.year, fn(d)]);
    const UN_COLOR = "var(--un)", INK = "var(--ink)", SC = "var(--scenario)";
    const tfr2 = (v) => v.toFixed(2);

    // fertility
    const tfrPts = [];
    if (s.latest) tfrPts.push({ x: s.latest.year, y: s.latest.tfr, color: "var(--female)", label: `${s.latest.tfr.toFixed(2)} (${s.latest.year})` });
    charts.tfr = lineChart($("#c-tfr"), {
      series: [
        { label: "UN estimates", color: INK, points: hist("tfr", 2023) },
        { label: "UN medium", color: UN_COLOR, dash: true, points: d3.range(2023, END + 1).map((y) => [y, unAt(loc, "tfr", y)]) },
        { label: "Your scenario", color: SC, points: scen((d) => d.tfr), width: 2.5, endLabel: tfr2 },
      ],
      hlines: [{ y: 2.1, label: "replacement ≈ 2.1" }],
      points: tfrPts,
      yFmt: d3.format(".1f"), tipFmt: tfr2,
      handle: sc.mode === "constant" ? null : {
        x: sc.mode === "custom" ? sc.targetYear : END,
        y: sc.mode === "custom" ? sc.target : unAt(loc, "tfr", END),
        onDrag: (nx, ny) => {
          if (sc.mode !== "custom") sc.mode = "custom";
          sc.targetYear = nx; sc.target = ny;
          update();
        },
      },
    });
    if (s.latest) d3.select("#c-tfr .chart-legend").append("span").attr("class", "it")
      .html(`<span class="bx" style="background:var(--female);border-radius:50%"></span>Latest reported`);

    // population
    const v = loc.variants || {};
    const bandRaw = v.lo95 && v.hi95 ? v.lo95.pop.map((lo, i) => [v.lo95.y0 + i, lo, v.hi95.pop[i]]).filter((p) => p[0] >= BASE && p[1] != null && p[2] != null) : null;
    const band = bandRaw && bandRaw.length ? bandRaw : null;
    charts.pop = lineChart($("#c-pop"), {
      series: [
        { label: "UN estimates", color: INK, points: hist("pop") },
        { label: "UN medium", color: UN_COLOR, dash: true, points: unFut("pop") },
        { label: "Your scenario", color: SC, points: scen((d) => d.pop), width: 2.5, endLabel: fmtPop },
      ],
      band: band ? { label: "UN 95% range", points: band } : null,
      yFmt: fmtAxisPop, tipFmt: fmtPop,
    });

    // births & deaths
    const join = (key, fn) => hist(key, BASE - 1).concat(res.filter((d) => d[fn] != null).map((d) => [d.year, d[fn]]));
    charts.bd = lineChart($("#c-bd"), {
      series: [
        { label: "Births", color: "var(--births)", points: join("births", "births"), endLabel: null },
        { label: "Deaths", color: "var(--deaths)", points: join("deaths", "deaths") },
      ],
      yFmt: fmtAxisPop, tipFmt: fmtPop,
    });

    // age structure (stacked shares)
    const hy = histYears(loc).filter((y) => y < BASE);
    const shares = hy.map((y) => { const p = histPyr(loc, y); return { year: y, ...ageShares(p.m, p.f) }; })
      .concat(res.map((d) => ({ year: d.year, ...ageShares(d.m, d.f) })));
    const ageKeys = [["old", "65+", "var(--age3)"], ["work", "15–64", "var(--age2)"], ["kids", "Under 15", "var(--age1)"]];
    charts.age = lineChart($("#c-age"), {
      series: ageKeys.map(([k, l, c]) => ({ label: l, color: c, area: true, points: shares.map((d) => [d.year, d[k]]), tipFmt: (v) => (v * 100).toFixed(1) + "%" })),
      yDomain: [0, 1], yFmt: d3.format(".0%"), tipFmt: (v) => (v * 100).toFixed(1) + "%",
      stack: (svg, x, y) => {
        const st = d3.stack().keys(["old", "work", "kids"])(shares);
        const gap = 1;
        st.forEach((layer, i) => {
          svg.append("path").datum(layer).style("fill", ageKeys[i][2])
            .attr("d", d3.area().x((p) => x(p.data.year)).y0((p) => y(p[0]) - (i ? gap : 0)).y1((p) => y(p[1]) + (i < 2 ? gap : 0)));
        });
      },
    });

    // median age
    charts.med = lineChart($("#c-med"), {
      series: [
        { label: "UN estimates", color: INK, points: hist("medAge") },
        { label: "UN medium", color: UN_COLOR, dash: true, points: unFut("medAge") },
        { label: "Your scenario", color: SC, points: scen((d) => d.medAge), width: 2.5, endLabel: (v) => v.toFixed(0) },
      ],
      zero: false, yFmt: d3.format("d"), tipFmt: (v) => v.toFixed(1),
    });

    // old-age dependency
    const unDep = histYears(loc).filter((y) => y >= BASE - 1).map((y) => { const p = histPyr(loc, y); return [y, ageShares(p.m, p.f).dep]; });
    charts.dep = lineChart($("#c-dep"), {
      series: [
        { label: "UN estimates", color: INK, points: hy.map((y) => { const p = histPyr(loc, y); return [y, ageShares(p.m, p.f).dep]; }) },
        { label: "UN medium", color: UN_COLOR, dash: true, points: unDep },
        { label: "Your scenario", color: SC, points: scen((d) => ageShares(d.m, d.f).dep), width: 2.5, endLabel: (v) => v.toFixed(0) },
      ],
      yFmt: d3.format("d"), tipFmt: (v) => v.toFixed(1),
    });
    drawYearMarkers();
  }

  /* ---------- boot ---------- */
  async function init() {
    try {
      const [summary, topo] = await Promise.all([
        fetch(DATA + "summary.json").then((r) => r.json()),
        fetch(DATA + "countries-50m.json").then((r) => r.json()),
      ]);
      state.summary = summary;
      for (const s of summary.locs) state.byId.set(s.id, s);
      state.topo = topo;
    } catch (e) {
      $("#panel").innerHTML = `<div class="loading">Couldn't load data. If you opened this file directly, serve the folder over HTTP.</div>`;
      return;
    }
    buildMap();
    setupMapControls();
    const h = readHash();
    const id = h.loc && state.byId.has(+h.loc) ? +h.loc : 900;
    selectLoc(id, false, h);

    let rt = null;
    window.addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (state.result) { drawPyramid(); drawTimeCharts(); } }, 150);
    });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const recolor = () => { colorMap(); if (state.result) drawTimeCharts(); };
    if (mq.addEventListener) mq.addEventListener("change", recolor);
  }

  init();
})();
