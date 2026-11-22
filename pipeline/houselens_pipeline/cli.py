"""``houselens ingest``: run every enabled source, isolating each source's failures."""

import argparse
import json
import os
import traceback
import uuid
from collections.abc import Callable
from datetime import date
from importlib import resources
from pathlib import Path

import duckdb
import polars as pl

from houselens_pipeline import ingest
from houselens_pipeline.adapters.base import Adapter, checksum, read_parts
from houselens_pipeline.adapters.fhfa import FhfaAdapter
from houselens_pipeline.adapters.fred import FredAdapter
from houselens_pipeline.adapters.realtor import RealtorAdapter
from houselens_pipeline.adapters.zillow import ZillowAdapter
from houselens_pipeline.catalog import Catalog, load_catalog, sync_catalog
from houselens_pipeline.db import connect
from houselens_pipeline.export import export_site_data
from houselens_pipeline.geo.reference import sync_geographies
from houselens_pipeline.geo.resolve import resolve_regions
from houselens_pipeline.ingest import IngestResult, write_vintage
from houselens_pipeline.quality.known_events import apply_known_events
from houselens_pipeline.quality.schemas import validate_obs

MAX_UNMATCHED_SHARE = 0.05
MANUAL_SOURCES = frozenset({"redfin"})  # manual-drop only: never fetched
_ADAPTERS: dict[str, Callable[[], Adapter]] = {
    "fhfa": FhfaAdapter,
    "zillow": ZillowAdapter,
    "realtor": RealtorAdapter,
}


def _config_bytes() -> dict[str, bytes]:
    """Config that shapes parsed output; fingerprinted so editing it defeats ``unchanged``."""
    return {
        "catalog.yaml": resources.files("houselens_pipeline").joinpath("catalog.yaml").read_bytes(),
        "known_events.yaml": resources.files("houselens_pipeline.quality")
        .joinpath("known_events.yaml")
        .read_bytes(),
    }


class SourceError(Exception):
    """A source failed for a known reason; the message is recorded as-is."""


def _adapter(source_id: str, served: bool, catalog: Catalog) -> Adapter:
    if source_id == "fred":
        key = os.environ.get("FRED_API_KEY", "")
        if not key and not served:
            raise SourceError("FRED_API_KEY not set")
        return FredAdapter(key, catalog=catalog)
    if source_id not in _ADAPTERS:
        raise SourceError("no adapter")
    return _ADAPTERS[source_id]()


def _ingest_source(
    con: duckdb.DuckDBPyConnection,
    source_id: str,
    catalog: Catalog,
    run_date: date,
    input_dir: Path | None,
    report_dir: Path,
    max_unmatched: float,
    note: list[str],
) -> IngestResult:
    drop = input_dir / source_id if input_dir else None
    served = drop is not None and drop.is_dir()
    if source_id in MANUAL_SOURCES and not served:
        raise SourceError("manual input missing")
    if served:
        note.append("(input-dir)")
    adapter = _adapter(source_id, served, catalog)
    parts = read_parts(drop) if drop is not None and served else adapter.fetch()
    # code changes still need a manual run; only config is fingerprinted
    digest = checksum({**parts, **{f"_config/{k}": v for k, v in _config_bytes().items()}})
    out = adapter.parse(parts, catalog)

    res = resolve_regions(source_id, out.regions)
    note.insert(0, f"unmatched={res.unmatched.height} skipped_by_rule={res.skipped_by_rule.height}")
    report_dir.mkdir(parents=True, exist_ok=True)
    report = {
        # sorted so nightly reports diff cleanly (adapters dedupe regions in no fixed order)
        "unmatched": res.unmatched.sort("vendor_region_id").to_dicts(),
        "skipped_by_rule": res.skipped_by_rule.sort("vendor_region_id").to_dicts(),
    }
    (report_dir / f"unmatched_{source_id}.json").write_text(json.dumps(report, indent=2) + "\n")
    # Bulk insert: ZIP-level sources map ~30k regions, too many for row-by-row executemany.
    con.from_arrow(res.mapping.__arrow_c_stream__()).query(
        "_map",
        "insert or replace into vendor_geo_map (source_id, vendor_region_id, vendor_name, geo_id,"
        " match_method) select source_id, vendor_region_id, vendor_name, geo_id, match_method"
        " from _map",
    )
    total = out.regions.height
    if total and res.unmatched.height / total > max_unmatched:
        raise SourceError(
            f"{res.unmatched.height}/{total} regions unmatched (> {max_unmatched:.0%})"
        )

    # unmatched and rule-skipped regions are dropped (and reported), never guessed
    obs = out.obs.join(
        res.mapping.select("vendor_region_id", "geo_id"), on="vendor_region_id", how="inner"
    ).drop("vendor_region_id")
    if "quality_flags" in obs.columns:
        obs = obs.with_columns(
            pl.col("quality_flags").fill_null(pl.lit([], dtype=pl.List(pl.String)))
        )
    obs = validate_obs(apply_known_events(obs))
    return write_vintage(con, source_id, obs, digest, run_date)


def run(
    db_path: Path,
    sources: list[str],
    run_date: date,
    input_dir: Path | None,
    report_dir: Path,
    *,
    max_unmatched: float = MAX_UNMATCHED_SHARE,
) -> int:
    """Ingest each requested, enabled source; one source failing never stops the others.

    Every source gets exactly one ``ingest_run`` row, including failures before the write
    (fetch, parse, resolution, validation, too many unmatched regions).

    Args:
        db_path: DuckDB file to write.
        sources: Source ids to run; ids that are not enabled in the catalog are skipped.
        run_date: Vintage date.
        input_dir: Optional directory of ``<source_id>/`` raw drops used instead of fetching.
        report_dir: Where ``unmatched_<source_id>.json`` reports go.
        max_unmatched: Fail a source whose unmatched share of regions exceeds this.

    Returns:
        0 if no source failed, else 1.
    """
    catalog = load_catalog()
    enabled = {s.source_id for s in catalog.sources if s.enabled}
    con = connect(db_path)
    try:
        sync_catalog(con, catalog)
        sync_geographies(con)
        failed = False
        for source_id in sources:
            if source_id not in enabled:
                print(f"{source_id}: skipped (not an enabled source)")
                continue
            started = ingest._now()
            note: list[str] = []
            try:
                result = _ingest_source(
                    con, source_id, catalog, run_date, input_dir, report_dir, max_unmatched, note
                )
            # polars panics are BaseException, not Exception; they must not end the run
            except (Exception, pl.exceptions.PanicException) as e:
                msg = str(e) if isinstance(e, SourceError) else f"{type(e).__name__}: {e}"
                result = IngestResult("failed", 0, msg)
                # shortcut: no checksum on pre-write failures; add one if ops needs to diff drops
                ingest._record_run(con, str(uuid.uuid4()), source_id, started, result, "")
            failed |= result.status == "failed"
            line = f"{source_id}: {result.status} rows={result.rows_written} {result.message}"
            print(" ".join([line, *note]))
    finally:
        con.close()
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    """Parse the command line and run ``houselens ingest`` or ``houselens export``.

    Args:
        argv: Arguments without the program name; defaults to ``sys.argv[1:]``.

    Returns:
        The process exit code: 0 ok, 1 some source failed, 2 crash.
    """
    p = argparse.ArgumentParser(prog="houselens")
    sub = p.add_subparsers(dest="command", required=True)
    ing = sub.add_parser("ingest", help="ingest every enabled source")
    ing.add_argument("--db", type=Path, required=True)
    ing.add_argument("--sources", help="comma-separated source ids (default: all enabled)")
    ing.add_argument("--run-date", type=date.fromisoformat, default=date.today())
    ing.add_argument("--input-dir", type=Path)
    ing.add_argument("--report-dir", type=Path, default=Path("reports"))
    ing.add_argument("--max-unmatched-share", type=float, default=MAX_UNMATCHED_SHARE)
    exp = sub.add_parser("export", help="export site JSON from a database")
    exp.add_argument("--db", type=Path, required=True)
    exp.add_argument("--out", type=Path, required=True)
    a = p.parse_args(argv)
    try:
        return _dispatch(a)
    except Exception:  # noqa: BLE001
        # exit 2 = crash: ingest.yml must not overwrite the R2 rollback DB with a bad one
        traceback.print_exc()
        return 2


def _dispatch(a: argparse.Namespace) -> int:
    if a.command == "export":
        con = connect(a.db)
        try:
            export_site_data(con, a.out, load_catalog())
        finally:
            con.close()
        return 0
    sources = (
        a.sources.split(",")
        if a.sources
        else [s.source_id for s in load_catalog().sources if s.enabled]
    )
    return run(
        a.db,
        sources,
        a.run_date,
        a.input_dir,
        a.report_dir,
        max_unmatched=a.max_unmatched_share,
    )
