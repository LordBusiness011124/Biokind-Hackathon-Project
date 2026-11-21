#!/usr/bin/env python3
"""Build the MEPS-derived model asset (aggregates only; no respondent microdata, no DUPERSID).
Usage: python scripts/build_baseline.py [--output packages/model-assets/derived]
Deterministic: same inputs -> byte-identical output."""
import argparse, json, sys
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, str(Path(__file__).parent))
from meps_common import *

MODEL_VERSION = "meps2024-v1"
MIN_CELL_N = 50      # min unweighted persons for a demographic cell to stand alone
MIN_PAY_N = 100      # >= this many events: payer-specific distribution stands alone
LOW_PAY_N = 30       # LOW_PAY_N..MIN_PAY_N-1: own distribution but flagged lowSample; below: pooled fallback

def wmean(x, w): return float((x * w).sum() / w.sum())

def build_cells(p, log):
    rate_cols = {"emergency": "ERTOT24", "outpatient": "OPTOTV24", "inpatient": "IPDIS24"}
    def stats(g, level, fallback_from=None):
        w = g.PERWT24F.values
        return {"n": int(len(g)), "weightedPop": float(w.sum()), "level": level,
                "ratesPerPersonYear": {s: wmean(g[c].values, w) for s, c in rate_cols.items()}}
    ap = {k: stats(g, "age_payer") for k, g in p.groupby(["age_band", "payer"])}
    pay = {k: stats(g, "payer") for k, g in p.groupby("payer")}
    overall = stats(p, "overall")
    cells, fb = [], 0
    for (a, py, inc), g in p.groupby(["age_band", "payer", "income_band"]):
        s = stats(g, "age_payer_income")
        rates_src = s
        if s["n"] < MIN_CELL_N:
            fb += 1
            rates_src = ap[(a, py)] if ap[(a, py)]["n"] >= MIN_CELL_N else (pay[py] if pay[py]["n"] >= MIN_CELL_N else overall)
        cells.append({"ageBand": a, "payer": py, "incomeBand": inc, "n": s["n"], "weightedPop": s["weightedPop"],
                      "ratesPerPersonYear": rates_src["ratesPerPersonYear"], "rateSource": rates_src["level"],
                      "sparse": s["n"] < MIN_CELL_N})
    log.append(f"{len(cells)} demographic cells; {fb} sparse (n<{MIN_CELL_N}) used fallback rates")
    tot = p.PERWT24F.sum()
    for c in cells: c["share"] = c["weightedPop"] / tot
    return cells

def build_payments(p, log):
    out, recon = {}, {}
    pid = p.set_index("DUPERSID")[["payer", "PERWT24F"]]
    person_col = {"emergency": ("ERTOT24", "ERTEXP24"), "outpatient": ("OPTOTV24", "OPTEXP24"), "inpatient": ("IPDIS24", "IPTEXP24")}
    for svc, spec in EVENT_PAY.items():
        cols = ["DUPERSID", "EVNTIDX", "PERWT24F", spec["fac"], spec["doc"], spec["oop_fac"], spec["chg"]]
        if svc == "inpatient": cols.append("NUMNIGHX")
        e = pd.read_stata(dta_path(spec["file"]), columns=cols, convert_categoricals=False)
        e["DUPERSID"] = e.DUPERSID.astype(str)
        n_raw = len(e)
        assert e.EVNTIDX.is_unique, f"{svc}: EVNTIDX not unique"
        e = e[e.PERWT24F > 0]
        e = e.join(pid[["payer"]], on="DUPERSID", how="inner")
        assert len(e) <= n_raw and e.EVNTIDX.is_unique, "join multiplied events"
        log.append(f"{svc}: {n_raw} events raw -> {len(e)} after weight>0 + person join (no duplication)")
        for c in (spec["fac"], spec["doc"], spec["oop_fac"]):
            assert (e[c] >= 0).all(), f"{svc}.{c} has negative/sentinel values; inspect codebook"
        # reconcile weighted event counts vs person-level annual counts
        pc = person_col[svc][0]
        ev_w = float(e.PERWT24F.sum()); pp_w = float((p[pc] * p.PERWT24F).sum())
        recon[svc] = {"weightedEventsFromEventFile": ev_w, "weightedEventsFromPersonFile": pp_w,
                      "ratio": ev_w / pp_w if pp_w else None,
                      "personFileWeightedExpenditureUSD": float((p[person_col[svc][1]] * p.PERWT24F).sum()),
                      "eventFileWeightedFacilityPaymentUSD": float((e[spec["fac"]] * e.PERWT24F).sum()),
                      "eventFileWeightedPhysicianPaymentUSD": float((e[spec["doc"]] * e.PERWT24F).sum())}
        def dist(g):
            w = g.PERWT24F.values
            d = {"nEvents": int(len(g)), "weightedEvents": float(w.sum())}
            for k, c in (("facilityPaymentCents", spec["fac"]), ("physicianPaymentCents", spec["doc"]),
                         ("facilityOutOfPocketCents", spec["oop_fac"])):
                vals = g[c].values; q95 = wquantiles(vals, w, [0.95])[0]; tail = vals >= q95
                d[k] = {"tailMean": cents(wmean(vals[tail], w[tail])), "mean": cents(wmean(g[c].values, w)), "zeroShare": float(w[g[c].values == 0].sum() / w.sum()),
                        "quantileGrid": QUANTILE_GRID,
                        "quantiles": [cents(v) for v in wquantiles(g[c].values, w, QUANTILE_GRID)]}
            if svc == "inpatient":
                n = g.NUMNIGHX.clip(lower=0).values
                d["nights"] = {"mean": wmean(n, w), "quantileGrid": QUANTILE_GRID, "quantiles": wquantiles(n.astype(float), w, QUANTILE_GRID)}
            return d
        pooled = dist(e)
        by = {}
        for py, g in e.groupby("payer"):
            if len(g) >= MIN_PAY_N: by[py] = {**dist(g), "source": "payer_specific"}
            elif len(g) >= LOW_PAY_N: by[py] = {**dist(g), "source": "payer_specific_low_sample"}
            else: by[py] = {**pooled, "source": "pooled_fallback", "sparseNEvents": int(len(g))}
        for py in PAYERS:
            if py not in by: by[py] = {**pooled, "source": "pooled_fallback", "sparseNEvents": 0}
        out[svc] = {"pooled": pooled, "byPayer": by}
    return out, recon

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output", default=str(DERIVED))
    a = ap.parse_args()
    log: list[str] = []
    p = load_persons(log)
    W = float(p.PERWT24F.sum())
    cells = build_cells(p, log)
    payments, recon = build_payments(p, log)
    payer_share = {py: float(p.loc[p.payer == py, "PERWT24F"].sum() / W) for py in PAYERS}
    age_share = {a_: float(p.loc[p.age_band == a_, "PERWT24F"].sum() / W) for a_, _, _ in AGE_BANDS}
    overall_rates = {s: wmean(p[c].values, p.PERWT24F.values) for s, c in
                     (("emergency", "ERTOT24"), ("outpatient", "OPTOTV24"), ("inpatient", "IPDIS24"))}
    src = json.loads((ROOT / "data" / "source_manifest.json").read_text())
    asset = {
        "modelVersion": MODEL_VERSION, "provenanceKind": "MEPS_CALIBRATED", "calibrationYear": 2024,
        "inputs": {k: {"dtaSha256": v["dta_sha256"], "sourceUrl": v["source_url"]} for k, v in src.items()},
        "counts": {"personsPositiveWeight": int(len(p)), "weightedPopulation": W},
        "definitions": {
            "ageBands": [a_[0] for a_ in AGE_BANDS], "payers": PAYERS,
            "payerHierarchy": "uninsured (INSCOV24==3) > medicare (MCREV24==1) > medicaid (MCDEV24==1) > private (PRVEV24==1) > other. Derived grouping, not an official MEPS variable.",
            "incomeBands": sorted(set(POVERTY_BANDS.values())) , "povertyVariable": "POVCAT24",
            "rateVariables": {"emergency": "ERTOT24", "outpatient": "OPTOTV24", "inpatient": "IPDIS24"},
            "paymentVariables": EVENT_PAY, "weight": "PERWT24F", "personKey": "DUPERSID (not exported)",
            "minCellN": MIN_CELL_N, "minPaymentN": MIN_PAY_N, "lowPaymentN": LOW_PAY_N,
            "caveat": "MEPS payments are expenditures by payment source, not hospital revenue, cost or profit."},
        "marginals": {"payerShare": payer_share, "ageShare": age_share, "overallRatesPerPersonYear": overall_rates},
        "cells": cells, "payments": payments, "reconciliation": recon, "buildLog": log,
    }
    out = Path(a.output); out.mkdir(parents=True, exist_ok=True)
    (out / "meps_baseline.json").write_text(json.dumps(asset, indent=1, sort_keys=True) + "\n")
    print("\n".join(log)); print("payer share:", {k: round(v, 3) for k, v in payer_share.items()})
    print("rates/person-yr:", {k: round(v, 3) for k, v in overall_rates.items()})
    for s, r in recon.items(): print(s, "event/person weighted count ratio:", round(r["ratio"], 3))
    print("wrote", out / "meps_baseline.json")

if __name__ == "__main__":
    main()
