# Current state
- Last updated UTC: 2026-11-21T15:35Z · branch main
- Works in browser: map, WASD/arrows, E interactions (desk, ER/clinic consoles, reception board), pause/1x/3x/10x, sim-to-year-end, sim-to-2044, Manage/Data/Assumptions tabs, year-end + final report with no-intervention comparison, save/load/export/import. Verified in Chrome: no console errors.
- Data loaded: REAL (MEPS_CALIBRATED). HC-256 h256.dta sha256 b4bde859b39f…, HC-254D 5a71c7680f11…, 254E 23071ad1ffa7…, 254F dd76d6426c5f… (full hashes in data/source_manifest.json). Variables: see scripts/meps_common.py.
- Start: `npm install && npm run dev`. Tests: `npm test` (15 pass); `npm run data` (11 validation checks pass); `npm run build` passes.
- Known issues: bundle 1.7MB (Phaser); mobile layout unaudited; inpatient locked; no variance estimates; patient sprites are a capped sample (18 queued/dept).
- Still fictional: everything in packages/model-assets/default-assumptions.json (catchment, hospital share, durations, staffing, costs, scenario drift). Hospital share + costs decide the balance.
- Next tasks: 1) balance pass + multi-seed median/10-90th bands; 2) design-based SEs with VARSTR/VARPSU for the Data tab; 3) inpatient ward from HC-254D (nights distribution already exported).
- First step for next dev: run the app, play 2024, then read docs/DATA_METHODS.md and docs/MODEL_ASSUMPTIONS.md.
