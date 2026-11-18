"""Catalog of sources, metrics and series, loaded from ``catalog.yaml``."""

from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any, Literal

import duckdb
import yaml


@dataclass(frozen=True)
class Source:
    """A data publisher; ``attribution`` and ``enabled`` are catalog-only."""

    source_id: str
    name: str
    publisher: str
    homepage_url: str
    license_note: str
    access_method: str
    attribution: str
    enabled: bool


@dataclass(frozen=True)
class Metric:
    """A measured quantity with its unit and good direction."""

    metric_id: str
    label: str
    unit: str
    higher_is: str


@dataclass(frozen=True)
class Series:
    """One published series; the last three fields are catalog-only."""

    series_id: str
    source_id: str
    metric_id: str
    method_family: str
    market: str
    property_type: str
    bedrooms: str
    tier: str
    new_or_existing: str
    seasonal_adj: bool
    frequency: Literal["weekly", "monthly", "quarterly"]
    typical_lag_days: int
    methodology_md: str
    release_date_kind: Literal["published", "first_seen"]
    vendor_key: str
    fixed_geo_id: str | None


@dataclass(frozen=True)
class Catalog:
    """All sources, metrics and series."""

    sources: tuple[Source, ...]
    metrics: tuple[Metric, ...]
    series: tuple[Series, ...]

    def series_by_vendor_key(self, source_id: str) -> dict[str, Series]:
        """Map vendor key to series for one source.

        Args:
            source_id: Source to filter on.

        Returns:
            Series of that source keyed by ``vendor_key``.
        """
        return {s.vendor_key: s for s in self.series if s.source_id == source_id}


_SERIES_DEFAULTS: dict[str, Any] = {
    "property_type": "all",
    "bedrooms": "all",
    "tier": "all",
    "new_or_existing": "all",
    "fixed_geo_id": None,
}


def load_catalog(path: Path | None = None) -> Catalog:
    """Load the catalog.

    Args:
        path: YAML file, or None for the packaged ``catalog.yaml``.

    Returns:
        The parsed catalog.
    """
    text = (
        path.read_text("utf-8")
        if path
        else resources.files("houselens_pipeline").joinpath("catalog.yaml").read_text("utf-8")
    )
    raw = yaml.safe_load(text)
    return Catalog(
        sources=tuple(Source(**s) for s in raw["sources"]),
        metrics=tuple(Metric(**m) for m in raw["metrics"]),
        series=tuple(Series(**{**_SERIES_DEFAULTS, **s}) for s in raw["series"]),
    )


def sync_catalog(con: duckdb.DuckDBPyConnection, catalog: Catalog) -> None:
    """Upsert source, metric and series rows (DB columns only).

    Args:
        con: Connection with the canonical schema applied.
        catalog: Catalog to write.
    """
    for s in catalog.sources:
        con.execute(
            "INSERT OR REPLACE INTO source VALUES (?,?,?,?,?,?)",
            [s.source_id, s.name, s.publisher, s.homepage_url, s.license_note, s.access_method],
        )
    for m in catalog.metrics:
        con.execute(
            "INSERT OR REPLACE INTO metric VALUES (?,?,?,?)",
            [m.metric_id, m.label, m.unit, m.higher_is],
        )
    for r in catalog.series:
        con.execute(
            "INSERT OR REPLACE INTO series VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                r.series_id, r.source_id, r.metric_id, r.method_family, r.market,
                r.property_type, r.bedrooms, r.tier, r.new_or_existing, r.seasonal_adj,
                r.frequency, r.typical_lag_days, r.methodology_md,
            ],
        )  # fmt: skip
