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
    """Resolve vendor regions: override, then ZIP or CBSA code, then US/state, then metro name.

    Codes apply only to levels ``ZIP`` (zero-padded to 5 digits) and ``CBSA``; an unknown code
    is unmatched (no name fallback). A CBSA
    name key shared by two or more CBSAs is ambiguous and left unmatched.

    Args:
        source_id: Source whose regions these are.
        regions: Columns ``vendor_region_id, vendor_name, level ("US"|"ST"|"CBSA"), code``.
        overrides: Manual map; defaults to ``vendor_overrides.yaml``.

    Returns:
        The mapping plus the unmatched and rule-skipped input rows.

    Raises:
        ValueError: An override for ``source_id`` names a geo_id that is not canonical.
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
    unique = {k: ids[0] for k, ids in keys.items() if len(ids) == 1}
    valid = set(geo["geo_id"])
    for rid, g in manual.items():
        if g not in valid:
            raise ValueError(f"override {source_id}/{rid} -> {g!r} is not a canonical geo_id")

    mapped: list[tuple[str, ...]] = []
    unmatched: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for r in regions.iter_rows(named=True):
        rid, name, level, code = r["vendor_region_id"], r["vendor_name"], r["level"], r["code"]
        cbsa_code = code if level == "CBSA" else None
        if rid in manual:
            hit = (manual[rid], "manual")
        elif level == "ZIP":
            zid = f"ZIP:{(code or '').zfill(5)}"
            if zid not in valid:
                unmatched.append(r)
                continue
            hit = (zid, "zip_code")
        elif cbsa_code in msads:
            skipped.append(r)
            continue
        elif cbsa_code in cbsa_codes:
            hit = (f"CBSA:{cbsa_code}", "cbsa_code")
        elif cbsa_code is not None:  # stale/unknown code: no name fallback; fix via overrides
            unmatched.append(r)
            continue
        elif level == "US":
            hit = ("US", "fips")
        elif level == "ST" and name is not None and _clean(name) in states:
            hit = (states[_clean(name)], "fips")
        elif level == "CBSA" and name is not None and (key := normalize_name(name)) in unique:
            hit = (unique[key], "name_fuzzy")
        else:
            unmatched.append(r)
            continue
        mapped.append((source_id, rid, name, *hit))
    return Resolved(
        mapping=pl.DataFrame(mapped, schema=MAPPING_SCHEMA, orient="row"),
        unmatched=pl.DataFrame(unmatched, schema=regions.schema),
        skipped_by_rule=pl.DataFrame(skipped, schema=regions.schema),
    )
