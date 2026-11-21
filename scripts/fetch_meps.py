#!/usr/bin/env python3
"""Download MEPS public-use files into data/raw/ and write data/source_manifest.json.
Usage: python scripts/fetch_meps.py [--dataset HC-256 ...] [--local-zip PATH --dataset HC-256]
If automated download is blocked, download the Stata zip manually and pass --local-zip."""
import argparse, datetime, json, shutil, sys, urllib.request, zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from meps_common import DATASETS, RAW, ROOT, sha256, dta_path

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dataset", action="append", choices=list(DATASETS), help="default: all")
    ap.add_argument("--local-zip", help="use a manually downloaded zip instead of fetching (single --dataset)")
    a = ap.parse_args()
    codes = a.dataset or list(DATASETS)
    manifest = {}
    for code in codes:
        d = DATASETS[code]; out = RAW / d["dir"]; out.mkdir(parents=True, exist_ok=True)
        z = out / d["zip"]
        if a.local_zip:
            shutil.copy(a.local_zip, z)
        elif not z.exists():
            req = urllib.request.Request(d["url"], headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=120) as r, open(z, "wb") as f:
                shutil.copyfileobj(r, f)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(out)
        manifest[code] = {"description": d["desc"], "source_url": d["url"], "details_page": d["details"],
                          "zip_file": str(z.relative_to(ROOT)), "zip_sha256": sha256(z),
                          "dta_file": str(dta_path(code).relative_to(ROOT)), "dta_sha256": sha256(dta_path(code)),
                          "retrieved_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
        print(f"{code}: ok {manifest[code]['dta_sha256'][:12]}")
    mp = ROOT / "data" / "source_manifest.json"
    old = json.loads(mp.read_text()) if mp.exists() else {}
    old.update(manifest); mp.write_text(json.dumps(old, indent=2) + "\n")

if __name__ == "__main__":
    main()
