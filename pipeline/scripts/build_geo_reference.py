"""Build ``cbsa.csv`` and ``msad.csv`` from Census delineation List 1 (July 2023).

Run once from ``pipeline/``:
``uv run --with openpyxl python -I scripts/build_geo_reference.py <list1_2023.xlsx>``
"""

import csv
import re
import sys
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parents[1] / "houselens_pipeline" / "geo" / "data"


def main(xlsx: str) -> None:
    """Read List 1 and write the deduplicated CBSA and MSAD tables.

    Args:
        xlsx: Path to ``list1_2023.xlsx``.
    """
    rows = openpyxl.load_workbook(xlsx, read_only=True).active.iter_rows(
        min_row=3, values_only=True
    )
    header = [str(h) for h in next(rows)]
    col = {name: header.index(name) for name in header}
    cbsa: dict[str, tuple[str, str]] = {}
    msad: dict[str, str] = {}
    for r in rows:
        code = str(r[col["CBSA Code"]] or "").strip()
        if not re.fullmatch(r"\d{5}", code):  # footnote rows
            continue
        cbsa[code] = (
            str(r[col["CBSA Title"]]).strip(),
            str(r[col["Metropolitan/Micropolitan Statistical Area"]]).strip(),
        )
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
    print(f"{len(cbsa)} CBSAs, {len(msad)} MSADs -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
