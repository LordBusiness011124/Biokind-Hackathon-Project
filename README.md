# Hospital Tycoon: 2044

A 2D pixel-art hospital management game whose patient demand and payments are calibrated to the 2024 Medical Expenditure Panel Survey (MEPS HC-256 + event files HC-254D/E/F). Scenario game, not a forecast or clinical tool.

## Run
```
npm install
npm run dev        # http://localhost:5173
npm test           # sim + data-asset tests (vitest)
npm run build      # typecheck + production build
```
## Rebuild the data asset from raw MEPS files (optional; derived asset is committed)
```
python3 -m venv .venv && .venv/bin/pip install pandas pyreadstat numpy
.venv/bin/python scripts/fetch_meps.py          # downloads to data/raw (gitignored), writes data/source_manifest.json
npm run data                                    # build_baseline.py + validate_baseline.py -> docs/DATA_REPORT.md
```
If the download is blocked, fetch the Stata zips manually and use `fetch_meps.py --dataset HC-256 --local-zip PATH`.

## Layout
`packages/sim` deterministic TS simulation · `packages/model-assets` derived MEPS JSON + `default-assumptions.json` · `apps/web` Vite+React+Phaser · `scripts/` Python ETL · `docs/`.
If `meps_baseline.json` is missing the app falls back to a clearly bannered DEMO SYNTHETIC mode.
