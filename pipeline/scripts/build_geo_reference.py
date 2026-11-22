"""Build ``cbsa.csv``, ``msad.csv`` and ``zip.csv`` from Census reference files.

Inputs: delineation List 1 (July 2023) and the 2020 ZCTA-to-county relationship file
(``tab20_zcta520_county20_natl.txt``). Run once from ``pipeline/``:
``uv run --with openpyxl python -I scripts/build_geo_reference.py <list1.xlsx> <zcta.txt>``
"""

import csv
import re
import sys
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parents[1] / "houselens_pipeline" / "geo" / "data"


def main(xlsx: str, zcta_county: str) -> None:
    """Read List 1 and the ZCTA relationship file; write the CBSA, MSAD and ZIP tables.

    Args:
        xlsx: Path to ``list1_2023.xlsx``.
        zcta_county: Path to ``tab20_zcta520_county20_natl.txt``.
    """
    rows = openpyxl.load_workbook(xlsx, read_only=True).active.iter_rows(
        min_row=3, values_only=True
    )
    header = [str(h) for h in next(rows)]
    col = {name: header.index(name) for name in header}
    cbsa: dict[str, tuple[str, str]] = {}
    msad: dict[str, str] = {}
    county_cbsa: dict[str, str] = {}
    for r in rows:
        code = str(r[col["CBSA Code"]] or "").strip()
        if not re.fullmatch(r"\d{5}", code):  # footnote rows
            continue
        cbsa[code] = (
            str(r[col["CBSA Title"]]).strip(),
            str(r[col["Metropolitan/Micropolitan Statistical Area"]]).strip(),
        )
        county_cbsa[f"{r[col['FIPS State Code']]}{r[col['FIPS County Code']]}"] = code
        div = str(r[col["Metropolitan Division Code"]] or "").strip()
        if div:
            msad[div] = code
    with open(OUT / "cbsa.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cbsa_code", "title", "type"])
        w.writerows((c, *cbsa[c]) for c in sorted(cbsa))
    with open(OUT / "msad.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["msad_code", "cbsa_code"])
        w.writerows((d, msad[d]) for d in sorted(msad))
    zips = _zip_counties(zcta_county)
    with open(OUT / "zip.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["zip", "county_fips", "county_name", "cbsa_code"])
        w.writerows((z, c, n, county_cbsa.get(c, "")) for z, (c, n) in sorted(zips.items()))
    print(f"{len(cbsa)} CBSAs, {len(msad)} MSADs, {len(zips)} ZIPs -> {OUT}")


def _zip_counties(path: str) -> dict[str, tuple[str, str]]:
    """Assign each ZCTA to the county holding most of its land area."""
    best: dict[str, tuple[int, str, str]] = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f, delimiter="|"):
            z, area = r["GEOID_ZCTA5_20"], int(r["AREALAND_PART"] or 0)
            if z and (z not in best or area > best[z][0]):
                best[z] = (area, r["GEOID_COUNTY_20"], r["NAMELSAD_COUNTY_20"])
    return {z: (c, n) for z, (_, c, n) in best.items()}


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
