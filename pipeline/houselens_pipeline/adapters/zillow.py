"""Zillow Research adapter: ZHVI and ZORI public CSV files, wide to long."""

import io

import httpx
import polars as pl

from houselens_pipeline.adapters.base import AdapterOutput
from houselens_pipeline.catalog import Catalog
from houselens_pipeline.normalize import periods

_BASE = "https://files.zillowstatic.com/research/public_csvs/"
_PATHS = {
    "zhvi_metro": "zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    "zhvi_state": "zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    "zori_metro": "zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv",
}
_LEVELS = {"country": "US", "state": "ST", "msa": "CBSA"}
_ID_COLS = ["RegionID", "SizeRank", "RegionName", "RegionType", "StateName"]
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


class ZillowAdapter:
    """Fetches and parses the Zillow Research CSV files."""

    source_id = "zillow"

    def __init__(self, client: httpx.Client | None = None) -> None:
        """Create the adapter.

        Args:
            client: Optional HTTP client (tests pass a mock transport).
        """
        self._client = client or httpx.Client(
            timeout=60, follow_redirects=True, transport=httpx.HTTPTransport(retries=3)
        )

    def fetch(self) -> dict[str, bytes]:
        """Download the three public CSV files.

        Returns:
            Parts named ``{part}.csv``.
        """
        parts: dict[str, bytes] = {}
        for part, path in _PATHS.items():
            r = self._client.get(_BASE + path)
            r.raise_for_status()
            parts[f"{part}.csv"] = r.content
        return parts

    def parse(self, parts: dict[str, bytes], catalog: Catalog) -> AdapterOutput:
        """Unpivot each known part to long form, skipping blank cells.

        Args:
            parts: Output of ``fetch``.
            catalog: Catalog mapping each part (in ``vendor_key``) to its series.

        Returns:
            Observations (release date null: first seen is set at ingest) and regions.
        """
        by_part = {
            p: s
            for key, s in catalog.series_by_vendor_key("zillow").items()
            for p in key.split("|")
        }
        frames: list[pl.DataFrame] = []
        regions: list[pl.DataFrame] = []
        for name, raw in parts.items():
            part = name.removesuffix(".csv")
            if part not in by_part:
                continue
            df = pl.read_csv(io.BytesIO(raw), infer_schema=False)
            regions.append(
                df.select(
                    vendor_region_id=pl.col("RegionID"),
                    vendor_name=pl.col("RegionName"),
                    level=pl.col("RegionType").replace_strict(_LEVELS),
                    code=pl.lit(None, pl.String),
                )
            )
            long = (
                df.unpivot(index=_ID_COLS, variable_name="month", value_name="v")
                .filter(pl.col("v").is_not_null() & (pl.col("v") != ""))
                .select(
                    series_id=pl.lit(by_part[part].series_id),
                    vendor_region_id=pl.col("RegionID"),
                    month=pl.col("month").str.to_date("%Y-%m-%d"),
                    value=pl.col("v").cast(pl.Float64),
                )
            )
            frames.append(long)
        rows = [
            {
                "series_id": r["series_id"],
                "vendor_region_id": r["vendor_region_id"],
                "period_start": periods.month(r["month"])[0],
                "period_end": periods.month(r["month"])[1],
                "value": r["value"],
                "release_date": None,
            }
            for f in frames
            for r in f.iter_rows(named=True)
        ]
        reg = pl.concat(regions).unique("vendor_region_id") if regions else None
        return AdapterOutput(
            obs=pl.DataFrame(rows, schema=_OBS_SCHEMA),
            regions=reg if reg is not None else pl.DataFrame(schema=_REGION_SCHEMA),
        )
