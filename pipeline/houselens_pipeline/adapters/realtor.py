"""Realtor.com research adapter: monthly inventory CSVs for country, state and metro."""

import io
from datetime import date

import httpx
import polars as pl

from houselens_pipeline.adapters.base import AdapterOutput
from houselens_pipeline.catalog import Catalog
from houselens_pipeline.normalize import periods

_URL = (
    "https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/"
    "RDC_Inventory_Core_Metrics_{}_History.csv"
)
_PARTS = {"country.csv": "Country", "state.csv": "State", "metro.csv": "Metro"}
# part -> (vendor id column, vendor name column, level, code column)
_REGION: dict[str, tuple[str | None, str, str, str | None]] = {
    "country.csv": (None, "country", "US", None),
    "state.csv": ("state_id", "state", "ST", None),
    "metro.csv": ("cbsa_code", "cbsa_title", "CBSA", "cbsa_code"),
}
_FLAG = "realtor_quality_flag"
# Columns stored as a 0-1 fraction whose catalog unit is pct; round(6) drops float noise.
_TO_PERCENT = frozenset({"price_reduced_share"})
_OBS_SCHEMA: dict[str, pl.DataType | type[pl.DataType]] = {
    "series_id": pl.String,
    "vendor_region_id": pl.String,
    "period_start": pl.Date,
    "period_end": pl.Date,
    "value": pl.Float64,
    "release_date": pl.Date,
    "quality_flags": pl.List(pl.String),
}
_REGION_SCHEMA: dict[str, pl.DataType | type[pl.DataType]] = {
    "vendor_region_id": pl.String,
    "vendor_name": pl.String,
    "level": pl.String,
    "code": pl.String,
}


class RealtorAdapter:
    """Fetches and parses Realtor.com Economic Research inventory files."""

    source_id = "realtor"

    def __init__(self, client: httpx.Client | None = None) -> None:
        """Create the adapter.

        Args:
            client: Optional HTTP client (tests pass a mock transport).
        """
        self._client = client or httpx.Client(
            timeout=120, follow_redirects=True, transport=httpx.HTTPTransport(retries=3)
        )

    def fetch(self) -> dict[str, bytes]:
        """Download the country, state and metro history files.

        Returns:
            Parts named ``country.csv``, ``state.csv`` and ``metro.csv``.
        """
        parts: dict[str, bytes] = {}
        for name, label in _PARTS.items():
            r = self._client.get(_URL.format(label))
            r.raise_for_status()
            parts[name] = r.content
        return parts

    def parse(self, parts: dict[str, bytes], catalog: Catalog) -> AdapterOutput:
        """Parse the CSVs into long observations, skipping blank values.

        Args:
            parts: Output of ``fetch``.
            catalog: Catalog mapping vendor columns to series.

        Returns:
            Observations and the regions they reference; ``quality_flags`` is never null.
        """
        series = catalog.series_by_vendor_key("realtor")
        frames: list[pl.DataFrame] = []
        regions: list[pl.DataFrame] = []
        for name, (id_col, name_col, level, code_col) in _REGION.items():
            if name not in parts:
                continue
            df = pl.read_csv(io.BytesIO(parts[name]), infer_schema=False).with_columns(
                vendor_region_id=pl.col(id_col) if id_col else pl.lit("US"),
                vendor_name=pl.col(name_col),
                level=pl.lit(level),
                code=pl.col(code_col) if code_col else pl.lit(None, pl.String),
            )
            regions.append(df.select(list(_REGION_SCHEMA)).unique(subset="vendor_region_id"))
            # quality_flag is "1.0"/"0.0"/blank in the live files.
            flagged = pl.col("quality_flag").cast(pl.Float64, strict=False) == 1
            for col, s in series.items():
                frames.append(
                    df.select(
                        series_id=pl.lit(s.series_id),
                        vendor_region_id="vendor_region_id",
                        month="month_date_yyyymm",
                        value=(pl.col(col).cast(pl.Float64) * 100).round(6)
                        if col in _TO_PERCENT
                        else pl.col(col).cast(pl.Float64),
                        flagged=flagged.fill_null(False),
                    ).drop_nulls("value")
                )
        rows = [
            {
                "series_id": r["series_id"],
                "vendor_region_id": r["vendor_region_id"],
                "period_start": start,
                "period_end": end,
                "value": r["value"],
                "release_date": None,
                "quality_flags": [_FLAG] if r["flagged"] else [],
            }
            for f in frames
            for r in f.iter_rows(named=True)
            for start, end in [periods.month(date(int(r["month"][:4]), int(r["month"][4:]), 1))]
        ]
        return AdapterOutput(
            obs=pl.DataFrame(rows, schema=_OBS_SCHEMA),
            regions=pl.concat(regions).unique(subset="vendor_region_id")
            if regions
            else pl.DataFrame(schema=_REGION_SCHEMA),
        )
