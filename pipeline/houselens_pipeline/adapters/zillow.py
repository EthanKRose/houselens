"""Zillow Research adapter: ZHVI and ZORI public CSV files, wide to long."""

import io

import httpx
import polars as pl

from houselens_pipeline.adapters.base import AdapterOutput
from houselens_pipeline.catalog import Catalog

_BASE = "https://files.zillowstatic.com/research/public_csvs/"
_PATHS = {
    "zhvi_metro": "zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    "zhvi_state": "zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    "zori_metro": "zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv",
    "zhvi_zip": "zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    **{
        f"zhvi_zip_b{b}": f"zhvi/Zip_zhvi_bdrmcnt_{b}_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
        for b in range(1, 6)
    },
    "zori_zip": "zori/Zip_zori_uc_sfrcondomfr_sm_sa_month.csv",
}
_LEVELS = {"country": "US", "state": "ST", "msa": "CBSA", "zip": "ZIP"}
# ZIP files keep only months from here on: enough for the latest, 1-year and 5-year comparisons
# the property analyzer makes, and ~4x fewer rows than full history.
_ZIP_FROM = "2019-01"
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
        """Download the public metro, state and ZIP CSV files.

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
            months = [c for c in df.columns if c[:4].isdigit()]
            if "_zip" in part:
                months = [c for c in months if c >= _ZIP_FROM]
            level = pl.col("RegionType").replace_strict(_LEVELS)
            regions.append(
                df.select(
                    vendor_region_id=pl.col("RegionID"),
                    vendor_name=pl.col("RegionName"),
                    level=level,
                    code=pl.when(level == "ZIP").then(pl.col("RegionName").str.zfill(5)),
                )
            )
            end = pl.col("month").str.to_date("%Y-%m-%d")
            frames.append(
                df.unpivot(index="RegionID", on=months, variable_name="month", value_name="v")
                .filter(pl.col("v").is_not_null() & (pl.col("v") != ""))
                .select(
                    series_id=pl.lit(by_part[part].series_id),
                    vendor_region_id=pl.col("RegionID"),
                    period_start=end.dt.month_start(),
                    period_end=end.dt.month_end(),
                    value=pl.col("v").cast(pl.Float64),
                    release_date=pl.lit(None, pl.Date),
                )
            )
        reg = pl.concat(regions).unique("vendor_region_id") if regions else None
        return AdapterOutput(
            obs=pl.concat(frames) if frames else pl.DataFrame(schema=_OBS_SCHEMA),
            regions=reg if reg is not None else pl.DataFrame(schema=_REGION_SCHEMA),
        )
