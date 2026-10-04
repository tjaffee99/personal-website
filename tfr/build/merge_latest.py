"""Attach the latest officially reported TFR (build/latest_tfr.json) to data/summary.json by ISO3 code."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SUMMARY = os.path.join(HERE, "..", "data", "summary.json")

latest = {r["iso3"]: r for r in json.load(open(os.path.join(HERE, "latest_tfr.json")))}
summary = json.load(open(SUMMARY))
hit = 0
for loc in summary["locs"]:
    r = latest.get(loc.get("iso3"))
    loc.pop("latest", None)
    if r:
        loc["latest"] = {k: r[k] for k in ("tfr", "year", "note", "source", "url") if r.get(k) not in (None, "")}
        hit += 1
json.dump(summary, open(SUMMARY, "w"), separators=(",", ":"), ensure_ascii=False)
print(f"attached latest TFR to {hit} of {len(latest)} records")
