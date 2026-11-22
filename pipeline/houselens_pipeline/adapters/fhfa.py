"""FHFA adapter: the single ``hpi_master.csv`` download."""

import io
from datetime import date

import httpx
import polars as pl

from houselens_pipeline.adapters.base import AdapterOutput
from houselens_pipeline.catalog import Catalog
from houselens_pipeline.normalize import periods

_URL = "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv"
_PART = "hpi_master.csv"
_OBS_SCHEMA: dict[str, pl.DataType | type[pl.DataType]] = {
    "series_id": pl.String,
    "vendor_region_id": pl.String,
    "period_start": pl.Date,
    "period_end": pl.Date,
    "value": pl.Float64,
    "release_date": pl.Date,
}
_REGION_SCHEMA: dict[str, pl.DataType | type[pl.DataType]] = {
    "vendor_region_id": pl.String,
    "vendor_name": pl.String,
    "level": pl.String,
    "code": pl.String,
}
_LEVELS = {"USA or Census Division": "US", "State": "ST", "MSA": "CBSA"}


class FhfaAdapter:
    """Fetches and parses the FHFA House Price Index master file."""

    source_id = "fhfa"

    def __init__(self, client: httpx.Client | None = None) -> None:
        """Create the adapter.

        Args:
            client: Optional HTTP client (tests pass a mock transport).
        """
        self._client = client or httpx.Client(
            timeout=120, follow_redirects=True, transport=httpx.HTTPTransport(retries=3)
        )

    def fetch(self) -> dict[str, bytes]:
        """Download the master CSV.

        Returns:
            Single part named ``hpi_master.csv``.
        """
        r = self._client.get(_URL)
        r.raise_for_status()
        return {_PART: r.content}

    def parse(self, parts: dict[str, bytes], catalog: Catalog) -> AdapterOutput:
        """Parse the master CSV for the catalog's FHFA series.

        Only ``traditional`` HPI rows matching a catalog ``vendor_key`` are kept; Census
        divisions and blank values are skipped. MSA rows, including metro divisions
        (MSAD), keep their ``place_id`` as ``code``.

        Args:
            parts: Output of ``fetch``.
            catalog: Catalog giving the ``flavor|frequency|level|column`` keys.

        Returns:
            Observations (``release_date`` null, i.e. first seen) and their regions.
        """
        keys = catalog.series_by_vendor_key("fhfa")
        df = pl.read_csv(io.BytesIO(parts[_PART]), infer_schema=False).filter(
            pl.col("hpi_type") == "traditional"
        )
        rows: list[dict[str, object]] = []
        regions: dict[str, dict[str, str | None]] = {}
        for r in df.iter_rows(named=True):
            col = None
            for k in keys:
                flavor, freq, level, c = k.split("|")
                if (r["hpi_flavor"], r["frequency"], r["level"]) == (flavor, freq, level):
                    col = c
                    break
            if col is None or r[col] in (None, ""):
                continue
            if r["level"] == "USA or Census Division" and r["place_id"] != "USA":
                continue
            s = keys[f"{r['hpi_flavor']}|{r['frequency']}|{r['level']}|{col}"]
            yr, p = int(r["yr"]), int(r["period"])
            start, end = (
                periods.month(date(yr, p, 1))
                if s.frequency == "monthly"
                else periods.quarter(yr, p)
            )
            pid = r["place_id"]
            lvl = _LEVELS[r["level"]]
            regions[pid] = {
                "vendor_region_id": pid,
                "vendor_name": r["place_name"],
                "level": lvl,
                "code": pid if lvl == "CBSA" else None,
            }
            rows.append(
                {
                    "series_id": s.series_id,
                    "vendor_region_id": pid,
                    "period_start": start,
                    "period_end": end,
                    "value": float(r[col]),
                    "release_date": None,
                }
            )
        return AdapterOutput(
            obs=pl.DataFrame(rows, schema=_OBS_SCHEMA),
            regions=pl.DataFrame(list(regions.values()), schema=_REGION_SCHEMA),
        )
