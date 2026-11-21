# Hospital Tycoon: 2044

An isometric pixel-art hospital management game where **the MEPS 2024 data is the teacher and the guide**. Patient demand, who arrives, and what they pay come from the Medical Expenditure Panel Survey (HC-256 plus event files HC-254D/E/F). It is a scenario game, not a forecast or clinical tool.

## How MEPS drives the game
- **Demand & payments:** every patient is sampled from survey-weighted (PERWT24F) cells by age, insurance and income; every visit's payment is drawn from MEPS payer-specific facility-payment distributions; inpatient stays use the MEPS nights distribution.
- **Yearly MEPS briefing:** each year you predict a real statistic (who uses the ER most, how skewed spending is, what payers pay, ...), then see the answer with its 95% design-based confidence interval and source variable. Correct answers earn a small data-literacy grant. Questions are generated from the loaded data, so they can never disagree with it.
- **Data Coach:** live advice that converts MEPS rates into capacity and finance guidance (expected arrivals, beds needed, payer-mix revenue, affordability).
- **MEPS Lab:** explore use rates by age, insurance and income with confidence intervals, plus spending concentration and a methods primer.
- **Reports:** year-end and final reports compare your patient mix to the MEPS population, show equity and affordability, a no-intervention comparison, and 20-seed variability bands.
- Every number is labelled MEPS_OBSERVED / MEPS_CALIBRATED / MODEL_ASSUMPTION / SIMULATED / DEMO_SYNTHETIC. Without the data asset the app runs in a clearly bannered DEMO mode.

## Run
```
npm install
npm run dev        # http://localhost:5173
npm test           # 24 sim/data/teaching tests (vitest)
npm run build      # typecheck + production build
```
Controls: WASD/arrows move, E interacts (desk, consoles, reception board, kiosk), Space pauses, M mutes, wheel zooms.

## Rebuild the data asset from raw MEPS (the derived asset is committed)
```
python3 -m venv .venv && .venv/bin/pip install pandas pyreadstat numpy
.venv/bin/python scripts/fetch_meps.py      # downloads to data/raw (gitignored), writes data/source_manifest.json
npm run data                                # build_baseline.py + validate_baseline.py -> docs/DATA_REPORT.md
```
If the download is blocked, fetch the Stata zips manually and pass `--dataset HC-256 --local-zip PATH`.

## Layout
`packages/sim` deterministic simulation + teaching engine · `packages/model-assets` derived MEPS JSON and `default-assumptions.json` · `apps/web` Vite + React + Phaser (isometric) · `scripts/` Python ETL · `docs/` methods, assumptions, data report.
