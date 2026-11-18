"""Known data-quality events and the flags they attach to observations."""

from datetime import date
from importlib import resources
from typing import Any

import polars as pl
import yaml


def _events() -> list[dict[str, Any]]:
    text = resources.files("houselens_pipeline.quality").joinpath("known_events.yaml")
    events: list[dict[str, Any]] = yaml.safe_load(text.read_text(encoding="utf-8"))
    return events


def load_known_events() -> dict[str, str]:
    """Return the event registry as ``{event id: explanation}``."""
    return {e["id"]: " ".join(e["explanation"].split()) for e in _events()}


def apply_known_events(df: pl.DataFrame) -> pl.DataFrame:
    """Append matching event ids to ``quality_flags`` (created if absent), deduped in order.

    Events lacking ``series_ids`` or ``period_starts`` are explanation-only and never applied.
    """
    if "quality_flags" not in df.columns:
        df = df.with_columns(pl.lit([], dtype=pl.List(pl.String)).alias("quality_flags"))
    flags = pl.col("quality_flags")
    for e in _events():
        if not e.get("series_ids") or not e.get("period_starts"):
            continue
        starts = [date.fromisoformat(str(s)) for s in e["period_starts"]]
        hit = pl.col("series_id").is_in(e["series_ids"]) & pl.col("period_start").is_in(starts)
        flags = (
            pl.when(hit & ~flags.list.contains(e["id"]))
            .then(flags.list.concat(pl.lit([e["id"]], dtype=pl.List(pl.String))))
            .otherwise(flags)
        )
    return df.with_columns(flags.alias("quality_flags"))
