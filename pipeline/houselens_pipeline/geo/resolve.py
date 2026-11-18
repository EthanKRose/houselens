"""Map vendor regions to canonical ``geo_id`` values (spec section 6.1 resolution order)."""

import re
from collections import defaultdict
from dataclasses import dataclass
from importlib import resources
from typing import Any

import polars as pl
import yaml

from houselens_pipeline.geo.reference import load_geographies, msad_codes

MAPPING_SCHEMA = {
    c: pl.String for c in ("source_id", "vendor_region_id", "vendor_name", "geo_id", "match_method")
}


@dataclass(frozen=True)
class Resolved:
    """Outcome of resolving one source's vendor regions.

    Attributes:
        mapping: Rows for ``vendor_geo_map``.
        unmatched: Input regions no rule matched.
        skipped_by_rule: Input regions deliberately not mapped (e.g. MSAD codes).
    """

    mapping: pl.DataFrame
    unmatched: pl.DataFrame
    skipped_by_rule: pl.DataFrame


def _clean(name: str) -> str:
    return " ".join(name.split()).lower()


def normalize_name(name: str) -> str:
    """Reduce a metro name to its ``"first principal city, first state"`` key.

    Args:
        name: A Census CBSA title or a vendor metro name, e.g. ``"Louisville/Jefferson County,
            KY-IN"`` or ``"Louisville, KY"``.

    Returns:
        Lowercased key with whitespace collapsed, e.g. ``"louisville, ky"``; just the city part
        when there is no state code.
    """
    name = _clean(name)
    city = re.split(r"[-/,]", name, maxsplit=1)[0].strip()
    _, comma, rest = name.partition(",")
    state = re.search(r"\b[a-z]{2}\b", rest) if comma else None
    return f"{city}, {state.group()}" if state else city


def load_overrides() -> dict[str, dict[str, str]]:
    """Load ``vendor_overrides.yaml``.

    Returns:
        ``{source_id: {vendor_region_id: geo_id}}`` with every key and value as a string.
    """
    text = resources.files("houselens_pipeline.geo").joinpath("vendor_overrides.yaml").read_text()
    raw: dict[Any, Any] = yaml.safe_load(text) or {}
    return {str(s): {str(k): str(v) for k, v in (m or {}).items()} for s, m in raw.items()}


def resolve_regions(
    source_id: str,
    regions: pl.DataFrame,
    *,
    overrides: dict[str, dict[str, str]] | None = None,
) -> Resolved:
    """Resolve vendor regions: override, then code, then US/state, then metro name key.

    A CBSA name key shared by two or more CBSAs is ambiguous and left unmatched.

    Args:
        source_id: Source whose regions these are.
        regions: Columns ``vendor_region_id, vendor_name, level ("US"|"ST"|"CBSA"), code``.
        overrides: Manual map; defaults to ``vendor_overrides.yaml``.

    Returns:
        The mapping plus the unmatched and rule-skipped input rows.
    """
    manual = (load_overrides() if overrides is None else overrides).get(source_id, {})
    geo = load_geographies()
    cbsa = geo.filter(pl.col("level") == "CBSA")
    cbsa_codes = {g.removeprefix("CBSA:") for g in cbsa["geo_id"]}
    msads = msad_codes()
    states = {
        _clean(n): g for g, n in geo.filter(pl.col("level") == "ST").select("geo_id", "name").rows()
    }
    keys: defaultdict[str, list[str]] = defaultdict(list)
    for g, n in cbsa.select("geo_id", "name").rows():
        keys[normalize_name(n)].append(g)

    mapped: list[tuple[str, ...]] = []
    unmatched: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for r in regions.iter_rows(named=True):
        rid, name, level, code = r["vendor_region_id"], r["vendor_name"], r["level"], r["code"]
        key = normalize_name(name)
        if rid in manual:
            hit = (manual[rid], "manual")
        elif code in msads:
            skipped.append(r)
            continue
        elif code in cbsa_codes:
            hit = (f"CBSA:{code}", "cbsa_code")
        elif level == "US":
            hit = ("US", "fips")
        elif level == "ST" and _clean(name) in states:
            hit = (states[_clean(name)], "fips")
        elif level == "CBSA" and len(keys.get(key, [])) == 1:
            hit = (keys[key][0], "name_fuzzy")
        else:
            unmatched.append(r)
            continue
        mapped.append((source_id, rid, name, *hit))
    return Resolved(
        mapping=pl.DataFrame(mapped, schema=MAPPING_SCHEMA, orient="row"),
        unmatched=pl.DataFrame(unmatched, schema=regions.schema),
        skipped_by_rule=pl.DataFrame(skipped, schema=regions.schema),
    )
