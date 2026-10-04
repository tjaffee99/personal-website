# Rebuilding the Fertility Explorer data

`../data/` is generated; the page itself (`../index.html`, `../app.js`, `../projection.js`) is static.

1. Download these UN WPP 2024 CSVs into `build/wpp/` (or point `WPP_DIR` at them) from
   `https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/`:
   - `WPP2024_Demographic_Indicators_Medium.csv.gz`
   - `WPP2024_Demographic_Indicators_OtherVariants.csv.gz`
   - `WPP2024_Fertility_by_Age1.csv.gz`
   - `WPP2024_PopulationBySingleAgeSex_Medium_1950-2023.csv.gz`
   - `WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz`
   - `WPP2024_Life_Table_Complete_Medium_Female_2024-2100.csv.gz`
   - `WPP2024_Life_Table_Complete_Medium_Male_2024-2100.csv.gz`
2. `pip install pandas numpy && python3 extract.py` writes `data/summary.json` and `data/loc/<LocID>.json`.
3. `python3 merge_latest.py` attaches the most recent national TFRs from `latest_tfr.json`
   (one record per country: iso3, tfr, year, note, source, url). Edit that file to add newer figures.

`data/countries-50m.json` is `world-atlas@2/countries-50m.json` (Natural Earth, public domain).
