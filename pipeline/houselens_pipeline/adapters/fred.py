"""FRED adapter: one observations request per FRED series id."""

import json
import logging
from datetime import date

import httpx
import polars as pl

from houselens_pipeline.adapters.base import AdapterOutput
from houselens_pipeline.catalog import Catalog, Series, load_catalog
from houselens_pipeline.normalize import periods

# httpx logs full request URLs at INFO, which would leak the api_key.
logging.getLogger("httpx").setLevel(logging.WARNING)

_URL = "https://api.stlouisfed.org/fred/series/observations"
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


def _fred_ids(catalog: Catalog) -> dict[str, tuple[Series, str | None]]:
    """Map FRED id to its series and CBSA code (None for national series)."""
    out: dict[str, tuple[Series, str | None]] = {}
    for key, s in catalog.series_by_vendor_key("fred").items():
        for part in key.split("|"):
            fid, _, cbsa = part.partition("=")
            out[fid] = (s, cbsa or None)
    return out


def _period(freq: str, d: date) -> tuple[date, date]:
    if freq == "weekly":
        return periods.week_ending(d)
    if freq == "monthly":
        return periods.month(d)
    return periods.quarter(d.year, (d.month - 1) // 3 + 1)


class FredAdapter:
    """Fetches and parses FRED series observations."""

    source_id = "fred"

    def __init__(self, api_key: str, client: httpx.Client | None = None) -> None:
        """Create the adapter.

        Args:
            api_key: FRED API key; never logged or put in error messages.
            client: Optional HTTP client (tests pass a mock transport).
        """
        self._key = api_key
        self._client = client or httpx.Client(timeout=30)

    def fetch(self) -> dict[str, bytes]:
        """Request every catalog FRED id.

        Returns:
            Parts named ``{FREDID}.json``.

        Raises:
            RuntimeError: On any request failure (key redacted); fails the whole fetch.
        """
        parts: dict[str, bytes] = {}
        for fid in _fred_ids(load_catalog()):
            try:
                r = self._client.get(
                    _URL, params={"series_id": fid, "api_key": self._key, "file_type": "json"}
                )
                r.raise_for_status()
            except httpx.HTTPError as e:
                # from None: the chained httpx error would carry the key in its URL.
                status = e.response.status_code if isinstance(e, httpx.HTTPStatusError) else None
                raise RuntimeError(
                    f"FRED fetch failed for {fid}: {type(e).__name__} status={status}"
                ) from None
            parts[f"{fid}.json"] = r.content
        return parts

    def parse(self, parts: dict[str, bytes], catalog: Catalog) -> AdapterOutput:
        """Parse FRED JSON parts, skipping ids not in the catalog and ``"."`` values.

        Args:
            parts: Output of ``fetch``.
            catalog: Catalog giving series, frequency and CBSA mapping.

        Returns:
            Observations and the regions they reference.
        """
        ids = _fred_ids(catalog)
        rows: list[dict[str, object]] = []
        regions: dict[str, dict[str, str | None]] = {}
        for name, raw in parts.items():
            fid = name.removesuffix(".json")
            if fid not in ids:
                continue
            s, cbsa = ids[fid]
            region = cbsa or s.fixed_geo_id or "US"
            if cbsa:
                regions[region] = {
                    "vendor_region_id": region,
                    "vendor_name": fid,
                    "level": "CBSA",
                    "code": cbsa,
                }
            else:
                regions[region] = {
                    "vendor_region_id": region,
                    "vendor_name": region,
                    "level": "US",
                    "code": None,
                }
            for o in json.loads(raw)["observations"]:
                if o["value"] == ".":
                    continue
                start, end = _period(s.frequency, date.fromisoformat(o["date"]))
                rows.append(
                    {
                        "series_id": s.series_id,
                        "vendor_region_id": region,
                        "period_start": start,
                        "period_end": end,
                        "value": float(o["value"]),
                        "release_date": date.fromisoformat(o["realtime_start"]),
                    }
                )
        return AdapterOutput(
            obs=pl.DataFrame(rows, schema=_OBS_SCHEMA),
            regions=pl.DataFrame(list(regions.values()), schema=_REGION_SCHEMA),
        )
