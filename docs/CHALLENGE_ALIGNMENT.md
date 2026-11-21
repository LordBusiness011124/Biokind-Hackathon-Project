# Challenge alignment: Biokind x UBSA 2026 Public Health Datathon

**Track 2: Healthcare Access.** Use MEPS to examine nationwide inequities in the economic burden associated with healthcare, focusing on the 2024 household full-year consolidated file (HC-256).

## Problem questions and where the product answers them
| # | Question | MEPS finding (2024, survey-weighted) | In the product |
|---|---|---|---|
| 1 | Who carries the economic burden of care? | 18.3% (±3.2) of people in poor families spend over 10% of family income out of pocket, versus 3.0% (±0.6) in high-income families, while poor families spend fewer dollars ($900 vs $3,724) | MEPS Lab "Who carries the economic burden?", affordability score, assistance fund |
| 2 | Is use of care equal across groups? | Medicare is 21% of people but 37% of ER events; the uninsured use the ER less per person than the privately insured (8.8 vs 12.3 per 100) | MEPS Lab explorer, patient mix |
| 3 | How skewed is spending? | Top 10% of people account for 66% of spending; median $1,700 vs mean $8,347 | Spending lesson, ward economics |
| 4 | What does insurance mean for the providers who deliver care? | ER facility payment: $2,073 private vs $630 Medicaid | Board decisions, access policy, equity score |
| 5 | What should decision-makers do? | Fairness has a price | Decisions, trust, final grade |

## Statistical techniques (judging criterion 1)
- Survey weights (`PERWT24F`) on every estimate; positive-weight persons only.
- Design-based standard errors: Taylor linearisation over strata (`VARSTR`) and PSUs (`VARPSU`); domain estimation with an indicator in numerator and denominator over the full sample.
- Economic burden measure: family out-of-pocket spending (sum of `TOTSLF24` over family members, `DUID`+`FAMIDYR`) divided by family income (`FAMINC24`), for people in families with positive income.
- Ratio estimators for rates; weighted quantiles and a tail-mean-preserving sampler for skewed payments.
- Reconciliation: weighted event counts from the event files (HC-254D/E/F) equal person-file counts.
- De-identified data practice: only aggregates leave the pipeline (no respondent IDs or rows), sparse cells flagged and pooled, sentinel codes checked.
- Simulation uncertainty reported separately (20-seed percentile bands), not mixed with MEPS sampling error.

## Audience and action item (judging criterion 3)
**Audience:** public-health students and hospital or community-health planners.
**Action:** play one run, compare your choices with the no-intervention branch, and use the equity and affordability results to discuss who should get help first. Next steps: add earlier MEPS years for trends, state-level context, and validation against hospital cost data.

## Limits (be honest and consistent)
MEPS is one year, covers the civilian noninstitutionalized population, and records payments (not hospital revenue or cost). Catchment size, hospital share, costs and decision effects are labelled game assumptions. The 2044 path is a scenario, not a forecast. `TOTSLF24` covers all out-of-pocket health spending, and 4.5% of family groups report differing person-level incomes.
