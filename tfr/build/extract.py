"""Extract compact per-location JSON from UN WPP 2024 CSVs for the TFR explorer."""
import json, math, os, sys
import numpy as np
import pandas as pd

W = os.environ.get("WPP_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "wpp"))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
os.makedirs(os.path.join(OUT, "loc"), exist_ok=True)

BASE = 2026
MORT_ANCHORS = [2026, 2035, 2050, 2065, 2080, 2100]
ASFR_ANCHORS = [2026, 2050, 2075, 2100]
REGIONS = {900: "World", 903: "Africa", 935: "Asia", 908: "Europe",
           904: "Latin America and the Caribbean", 905: "Northern America", 909: "Oceania"}


def rd(path, usecols, years=None, variants=None, chunks=True):
    parts = []
    for ch in pd.read_csv(os.path.join(W, path), usecols=usecols, chunksize=2_000_000, encoding="utf-8-sig",
                          low_memory=False):
        ch = ch[(ch.LocTypeID == 4) | ch.LocID.isin(REGIONS)]
        if years is not None:
            ch = ch[ch.Time.isin(years)]
        if variants is not None:
            ch = ch[ch.Variant.isin(variants)]
        parts.append(ch)
    return pd.concat(parts)


print("indicators")
ind = rd("WPP2024_Demographic_Indicators_Medium.csv.gz",
         ["LocID", "LocTypeID", "ISO3_code", "Location", "Time", "TPopulation1July", "TFR", "Births", "Deaths",
          "MedianAgePop", "LEx", "NetMigrations", "SRB", "Variant"])
locs = ind.drop_duplicates("LocID")[["LocID", "LocTypeID", "ISO3_code", "Location"]]
var = rd("WPP2024_Demographic_Indicators_OtherVariants.csv.gz",
         ["LocID", "LocTypeID", "Time", "TPopulation1July", "TFR", "Variant"],
         variants=["Low", "High", "Lower 95 PI", "Upper 95 PI", "Constant fertility", "Zero migration"])

print("pop")
pyr_years = list(range(1950, 2021, 5)) + [2023]
pop_hist = rd("WPP2024_PopulationBySingleAgeSex_Medium_1950-2023.csv.gz",
              ["LocID", "LocTypeID", "Time", "AgeGrpStart", "PopMale", "PopFemale"], years=pyr_years)
pop_fut = rd("WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz",
             ["LocID", "LocTypeID", "Time", "AgeGrpStart", "PopMale", "PopFemale"])

print("life tables")
lt_years = list(range(2024, 2101))
lt = pd.concat([rd(f"WPP2024_Life_Table_Complete_Medium_{s}_2024-2100.csv.gz",
                   ["LocID", "LocTypeID", "Time", "SexID", "AgeGrpStart", "Sx"], years=lt_years)
                for s in ("Female", "Male")])

print("fertility")
fert = rd("WPP2024_Fertility_by_Age1.csv.gz", ["LocID", "LocTypeID", "Time", "AgeGrpStart", "PASFR", "Variant"],
          years=ASFR_ANCHORS, variants=["Medium"])


def sig(x, n=4):
    if x == 0 or not math.isfinite(x):
        return 0
    return float(f"{x:.{n}g}")


def rnd(x, d):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), d)


def pyramid(df, year):
    d = df[df.Time == year].sort_values("AgeGrpStart")
    return d.PopMale.to_numpy() * 1000, d.PopFemale.to_numpy() * 1000


pop_fut_g = dict(tuple(pop_fut.groupby("LocID")))
pop_hist_g = dict(tuple(pop_hist.groupby("LocID")))
lt_g = dict(tuple(lt.groupby("LocID")))
fert_g = dict(tuple(fert.groupby("LocID")))
ind_g = dict(tuple(ind.groupby("LocID")))
var_g = dict(tuple(var.groupby("LocID")))

summary = []
for _, L in locs.iterrows():
    lid = int(L.LocID)
    I = ind_g[lid].sort_values("Time")
    pf, ph, lg = pop_fut_g[lid], pop_hist_g[lid], lt_g[lid]

    def sx(year, sex):
        d = lg[(lg.Time == year) & (lg.SexID == sex)].sort_values("AgeGrpStart")
        return d.Sx.to_numpy()  # index x: survival from age x-1 (or birth) to x; [100] is open group

    # UN-implied net migration by age/sex (residual of the medium projection), averaged in 5-year blocks
    resid = {}
    for t in range(BASE, 2100):
        m0, f0 = pyramid(pf, t)
        m1, f1 = pyramid(pf, t + 1)
        r = np.zeros(202)
        for k, (p0, p1, s) in enumerate(((m0, m1, 1), (f0, f1, 2))):
            S = sx(t, s)
            r[k * 101 + 1:k * 101 + 100] = p1[1:100] - p0[0:99] * S[1:100]
            r[k * 101 + 100] = p1[100] - (p0[99] + p0[100]) * S[100]
        resid[t] = r
    mig_age = {}
    for start in range(BASE, 2100, 5):
        blk = [t for t in range(start, min(start + 5, 2100))]
        mid = round(sum(blk) / len(blk), 1)
        mig_age[mid] = [int(round(v)) for v in np.mean([resid[t] for t in blk], axis=0)]

    m, f = pyramid(pf, BASE)

    def scaled_pyr(m, f):
        mx = max(m.max(), f.max(), 1)
        sc = 10 ** max(0, math.ceil(math.log10(mx / 99999)))
        return {"s": sc, "m": [int(round(v / sc)) for v in m], "f": [int(round(v / sc)) for v in f]}

    pyrs = {}
    for y in pyr_years:
        pyrs[y] = scaled_pyr(*pyramid(ph, y))
    for y in [2024, 2025] + list(range(2030, 2101, 5)):
        pyrs[y] = scaled_pyr(*pyramid(pf, y))

    asfr = {}
    for y in ASFR_ANCHORS:
        d = fert_g[lid][fert_g[lid].Time == y].sort_values("AgeGrpStart")
        p = d.PASFR.to_numpy()
        asfr[y] = [sig(v / p.sum(), 4) for v in p]

    mort = {}
    for y in MORT_ANCHORS:
        mort[y] = {"m": [sig(1 - v, 4) for v in sx(y, 1)], "f": [sig(1 - v, 4) for v in sx(y, 2)]}

    fut = I[I.Time >= BASE]
    V = var_g.get(lid)
    variants = {}
    if V is not None:
        for vn, key in [("Low", "low"), ("High", "high"), ("Lower 95 PI", "lo95"), ("Upper 95 PI", "hi95"),
                        ("Constant fertility", "constF"), ("Zero migration", "zeroMig")]:
            d = V[(V.Variant == vn) & (V.Time >= 2024)].sort_values("Time")
            if len(d):
                variants[key] = {"y0": int(d.Time.iloc[0]),
                                 "pop": [rnd(v * 1000, 0) for v in d.TPopulation1July],
                                 "tfr": [rnd(v, 3) for v in d.TFR]}
    name = L.Location if lid not in REGIONS else REGIONS[lid]
    rec = {
        "id": lid, "iso3": L.ISO3_code if isinstance(L.ISO3_code, str) else None, "name": name,
        "base": {"year": BASE, "m": [round(v) for v in m], "f": [round(v) for v in f]},
        "pyr": pyrs,
        "asfr": asfr,
        "mort": mort,
        "migAge": mig_age,
        "un": {
            "y0": int(I.Time.iloc[0]),
            "pop": [rnd(v * 1000, 0) for v in I.TPopulation1July],
            "tfr": [rnd(v, 3) for v in I.TFR],
            "births": [rnd(v * 1000, 0) for v in I.Births],
            "deaths": [rnd(v * 1000, 0) for v in I.Deaths],
            "medAge": [rnd(v, 2) for v in I.MedianAgePop],
            "lex": [rnd(v, 2) for v in I.LEx],
            "mig": [rnd(v * 1000, 0) for v in I.NetMigrations],
            "srb": [rnd(v, 2) for v in I.SRB],
        },
        "variants": variants,
    }
    with open(os.path.join(OUT, "loc", f"{lid}.json"), "w") as fh:
        json.dump(rec, fh, separators=(",", ":"))
    summary.append({
        "id": lid, "iso3": rec["iso3"], "name": name, "region": lid in REGIONS,
        "pop": rnd(I[I.Time == BASE].TPopulation1July.iloc[0] * 1000, 0),
        "tfr": [rnd(v, 2) for v in I[I.Time <= 2100].TFR],
    })

with open(os.path.join(OUT, "summary.json"), "w") as fh:
    json.dump({"y0": 1950, "base": BASE, "source": "UN World Population Prospects 2024", "locs": summary}, fh,
              separators=(",", ":"))
print("done", len(summary))
