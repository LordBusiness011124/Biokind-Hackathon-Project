# Model assumptions
All fictional/illustrative parameters live in `packages/model-assets/default-assumptions.json` (each is MODEL_ASSUMPTION; none are MEPS findings): catchment N=25,000; hospital share ER 35% / outpatient 20%; treatment durations by severity (1 tick = 1 hour); staffing FTE-to-post factors; salaries, room costs, per-encounter variable cost, overhead; process-improvement effect; ER diversion after 12 h wait and clinic walk-out after 72 h (counted as unmet demand, never as revenue); scenario drift (population +0.5%/yr, utilization +0.4%/yr, medical prices and wages +3%/yr, 65+ share growth) which are NOT Census/CMS projections.
Mechanics: 1 tick = 1 hour, 8,760/year, 2024-2044 = 21 full simulated years/snapshots. Arrivals use their own seeded stream, so identical seeds give identical patients regardless of player decisions (enables the no-intervention comparison). Patient OOP = facility payment × payer-specific MEPS mean OOP/mean payment ratio. Financial assistance forgives eligible OOP up to a yearly fund and books it as `cost.subsidy`. Bankruptcy: cash <0 for >60 consecutive days halts the game.
Starting economics were tuned for playability: baseline staffing loses ~$0.5M/yr; trimming idle clinic capacity or growing ER capacity is the core decision.

## Added in the final build
- **Inpatient ward** (playable): 6 beds per staffing post (4.5 physician + 9 nurse FTE), hospital share 12%, stay length from the MEPS nights distribution (capped 30), diversion after 24 h wait.
- **Penalties** for diverted ER ($2,000) and inpatient ($1,500) patients, inflation-adjusted: a modelled cost of unsafe capacity, not a MEPS finding.
- **Prices vs wages:** medical prices +2.5%/yr, wages +3.5%/yr, general +3%/yr (illustrative, creates margin pressure).
- **Data-literacy grants:** $25,000 per correct briefing answer (game design; capped at $50,000 per grant). Grants are booked as `revenue.grant`.
- Balance: doing nothing goes bankrupt in ~4-7 years; trimming idle clinic staff scrapes by; opening the ward is the main path to financial health; adding ER capacity reduces diversions at a financial cost.

## Scoring and challenge mode
- **Scorecard** (`packages/sim/src/scorecard.ts`, weights in `default-assumptions.json`): finance 30%, access 20%, emergency safety 15%, equity 15%, affordability 10%, data IQ 10%. Finance: bankrupt = 0, >=2x starting cash = 100. Access: 80% treated = 0, 99% = 100. Safety: 0% ER/ward diversions = 100, 10% = 0. Equity: spread of average wait across insurance groups (0 h = 100, 4 h = 0). Affordability: 40 baseline, 100 when half of low-income out-of-pocket is relieved. All thresholds are game design.
- **Challenge mode** (opt-in): per-year event rolled from a hash of (seed, year), so decisions never change it: flu season 10% (ER x1.25, clinic/ward x1.15), recession 8% (uninsured weight x1.35, clinic x0.95), staffing shortage 8% (wages +10%). Illustrative, not epidemiological or economic facts.
