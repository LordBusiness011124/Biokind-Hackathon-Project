"""Shared helpers for the MEPS ETL. Only variables verified against the real 2024 files are used."""
from __future__ import annotations
import hashlib, json
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DERIVED = ROOT / "packages" / "model-assets" / "derived"

DATASETS = {
    "HC-256": {"dir": "h256", "file": "h256.dta", "zip": "h256dta.zip",
               "desc": "2024 Full Year Consolidated Data File",
               "url": "https://meps.ahrq.gov/mepsweb/data_files/pufs/h256/h256dta.zip",
               "details": "https://meps.ahrq.gov/mepsweb/data_stats/download_data_files_detail.jsp?cboPufNumber=HC-256"},
    "HC-254D": {"dir": "h254d", "file": "h254d.dta", "zip": "h254ddta.zip", "desc": "2024 Hospital Inpatient Stays",
                "url": "https://meps.ahrq.gov/mepsweb/data_files/pufs/h254d/h254ddta.zip",
                "details": "https://meps.ahrq.gov/mepsweb/data_stats/download_data_files_detail.jsp?cboPufNumber=HC-254D"},
    "HC-254E": {"dir": "h254e", "file": "h254e.dta", "zip": "h254edta.zip", "desc": "2024 Emergency Room Visits",
                "url": "https://meps.ahrq.gov/mepsweb/data_files/pufs/h254e/h254edta.zip",
                "details": "https://meps.ahrq.gov/mepsweb/data_stats/download_data_files_detail.jsp?cboPufNumber=HC-254E"},
    "HC-254F": {"dir": "h254f", "file": "h254f.dta", "zip": "h254fdta.zip", "desc": "2024 Outpatient Visits",
                "url": "https://meps.ahrq.gov/mepsweb/data_files/pufs/h254f/h254fdta.zip",
                "details": "https://meps.ahrq.gov/mepsweb/data_stats/download_data_files_detail.jsp?cboPufNumber=HC-254F"},
}

AGE_BANDS = [("0-17", 0, 17), ("18-44", 18, 44), ("45-64", 45, 64), ("65+", 65, 200)]
PAYERS = ["private", "medicare", "medicaid", "uninsured", "other"]
POVERTY_BANDS = {1: "<200%FPL", 2: "<200%FPL", 3: "<200%FPL", 4: "200-399%FPL", 5: "400%+FPL"}
SERVICES = ["emergency", "outpatient", "inpatient"]
QUANTILE_GRID = [round(i / 20, 2) for i in range(21)]  # 0,0.05,...,1

# Person-file variables actually used (verified present in HC-256).
PERSON_VARS = ["DUPERSID", "PERWT24F", "VARSTR", "VARPSU", "AGELAST", "SEX", "INSCOV24", "POVCAT24",
               "MCREV24", "MCDEV24", "PRVEV24", "ERTOT24", "OPTOTV24", "IPDIS24", "IPNGTD24",
               "ERTEXP24", "OPTEXP24", "IPTEXP24", "TOTEXP24"]

# Event-file payment variables (verified). F*=facility, D*=physician/doctor. SF=self/family.
EVENT_PAY = {
    "emergency": {"file": "HC-254E", "fac": "ERFXP24X", "doc": "ERDXP24X", "oop_fac": "ERFSF24X", "chg": "ERFTC24X"},
    "outpatient": {"file": "HC-254F", "fac": "OPFXP24X", "doc": "OPDXP24X", "oop_fac": "OPFSF24X", "chg": "OPFTC24X"},
    "inpatient": {"file": "HC-254D", "fac": "IPFXP24X", "doc": "IPDXP24X", "oop_fac": "IPFSF24X", "chg": "IPFTC24X"},
}

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def dta_path(code: str) -> Path:
    d = DATASETS[code]
    return RAW / d["dir"] / d["file"]

def age_band(age: int) -> str:
    for name, lo, hi in AGE_BANDS:
        if lo <= age <= hi:
            return name
    raise ValueError(f"age out of range: {age}")

def load_persons(log: list[str]) -> pd.DataFrame:
    p = pd.read_stata(dta_path("HC-256"), columns=PERSON_VARS, convert_categoricals=False)
    p["DUPERSID"] = p["DUPERSID"].astype(str)
    n0 = len(p)
    assert p.DUPERSID.is_unique, "DUPERSID not unique in person file"
    p = p[p.PERWT24F > 0].copy()
    log.append(f"person rows: {n0} total, {len(p)} with PERWT24F>0")
    for c in ["AGELAST", "ERTOT24", "OPTOTV24", "IPDIS24", "ERTEXP24", "OPTEXP24", "IPTEXP24"]:
        neg = int((p[c] < 0).sum())
        if neg:
            log.append(f"WARNING {c}: {neg} negative codes among positive-weight persons; treated as missing->excluded")
    bad = (p[["AGELAST", "ERTOT24", "OPTOTV24", "IPDIS24"]] < 0).any(axis=1)
    p = p[~bad].copy()
    # Payer hierarchy (derived, documented in DATA_METHODS): uninsured all-year-flag -> Medicare ever -> Medicaid ever -> private ever -> other public.
    unins = p.INSCOV24 == 3
    p["payer"] = np.select([unins, p.MCREV24 == 1, p.MCDEV24 == 1, p.PRVEV24 == 1],
                           ["uninsured", "medicare", "medicaid", "private"], default="other")
    p["age_band"] = p.AGELAST.map(age_band)
    p["income_band"] = p.POVCAT24.map(POVERTY_BANDS).fillna("unknown")
    return p

def wquantiles(values: np.ndarray, weights: np.ndarray, qs: list[float]) -> list[float]:
    order = np.argsort(values, kind="stable")
    v, w = values[order], weights[order]
    cw = np.cumsum(w) / w.sum()
    return [float(v[min(np.searchsorted(cw, q, side="left"), len(v) - 1)]) for q in qs]

def cents(x: float) -> int:
    return int(round(float(x) * 100))
