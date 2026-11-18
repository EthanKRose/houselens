"""Vintage writer: append canonical observations to DuckDB without overwriting history."""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Literal

import duckdb
import polars as pl

Status = Literal["ok", "unchanged", "failed"]

# Rows that are new, or whose value/flags differ from observation_latest; `collides` marks rows
# whose (series, geo, period_start, run_date) key already exists (a same-day re-run).
_CANDIDATES = """
create or replace temp table _cand as
select n.*, exists (
    select 1 from observation o
    where o.series_id = n.series_id and o.geo_id = n.geo_id
      and o.period_start = n.period_start and o.vintage_date = $run_date
) as collides
from _new n left join observation_latest l using (series_id, geo_id, period_start)
where l.series_id is null
   or n.value is distinct from l.value
   or list_sort(n.quality_flags) is distinct from list_sort(l.quality_flags)
"""

_COVERAGE = """
with n as (select series_id, count(distinct geo_id) c from _new group by 1),
     cur as (select series_id, count(distinct geo_id) c from observation_latest group by 1)
select series_id, n.c, cur.c from n join cur using (series_id)
where n.c < 0.95 * cur.c order by 1
"""


@dataclass
class IngestResult:
    """Outcome of one ``write_vintage`` call.

    Attributes:
        status: ``ok`` (rows may be 0), ``unchanged`` (same checksum as the last good run)
            or ``failed`` (nothing written).
        rows_written: Number of observation rows inserted.
        message: Human-readable detail, also stored in ``ingest_run.message``.
    """

    status: Status
    rows_written: int
    message: str


def _now() -> datetime:
    # ingest_run uses naive TIMESTAMP; store UTC wall time
    return datetime.now(UTC).replace(tzinfo=None)


def _write(
    con: duckdb.DuckDBPyConnection,
    source_id: str,
    obs: pl.DataFrame,
    checksum: str,
    run_date: date,
) -> tuple[Status, int, str]:
    last = con.execute(
        "select file_checksum from ingest_run where source_id = ?"
        " and status in ('ok', 'unchanged') order by finished_at desc limit 1",
        [source_id],
    ).fetchall()
    if last and last[0][0] == checksum:
        return "unchanged", 0, f"checksum {checksum} matches last good run"

    # Arrow PyCapsule lets DuckDB read the Polars frame without a pyarrow dependency
    con.register("_src", con.from_arrow(obs.__arrow_c_stream__()))
    con.execute("create or replace temp table _new as select * from _src")
    con.unregister("_src")
    drops = con.execute(_COVERAGE).fetchall()
    if drops:
        detail = "; ".join(f"{s}: {n} geos vs {c} in observation_latest" for s, n, c in drops)
        return "failed", 0, f"coverage drop >5%: {detail}"

    con.execute(_CANDIDATES, {"run_date": run_date})
    [(rows,)] = con.execute(
        "insert into observation (series_id, geo_id, period_start, period_end, value,"
        " vintage_date, release_date, quality_flags)"
        " select series_id, geo_id, period_start, period_end, value, $run_date,"
        " coalesce(release_date, $run_date), quality_flags from _cand where not collides",
        {"run_date": run_date},
    ).fetchall()
    [(skipped,)] = con.execute("select count(*) from _cand where collides").fetchall()
    msg = f"wrote {rows} rows at vintage {run_date}"
    if skipped:
        msg += f"; skipped {skipped} changed rows already present at vintage {run_date}"
    return "ok", int(rows), msg


def _record_run(
    con: duckdb.DuckDBPyConnection,
    run_id: str,
    source_id: str,
    started_at: datetime,
    result: IngestResult,
    checksum: str,
) -> None:
    con.execute(
        "insert into ingest_run (run_id, source_id, started_at, finished_at, status,"
        " file_checksum, rows_written, message) values (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            run_id,
            source_id,
            started_at,
            _now(),
            result.status,
            checksum,
            result.rows_written,
            result.message,
        ],
    )


def write_vintage(
    con: duckdb.DuckDBPyConnection,
    source_id: str,
    obs: pl.DataFrame,
    checksum: str,
    run_date: date,
) -> IngestResult:
    """Append a validated canonical frame as a new vintage, never touching existing rows.

    Rules, in order:

    1. If the most recent ``ok``/``unchanged`` run for ``source_id`` (failed runs never count)
       has the same ``file_checksum``, the result is ``unchanged`` with 0 rows.
    2. For each series present in both ``obs`` and ``observation_latest``, if the new distinct
       ``geo_id`` count is below 95% of the current one, the result is ``failed`` with 0 rows.
       A series missing from ``obs`` entirely is not checked.
    3. A row is inserted with ``vintage_date = run_date`` only if its
       ``(series_id, geo_id, period_start)`` is new, or its ``value`` (exact float equality)
       or its ``quality_flags`` (order-insensitive) differ from ``observation_latest``; a flags
       change alone therefore creates a new vintage. A null ``release_date`` becomes
       ``run_date`` (first seen).
    4. If a changed row's ``(series_id, geo_id, period_start, run_date)`` already exists (a
       same-day re-run), it is skipped and counted in the message; nothing is updated.

    All inserts and the ``ingest_run`` row share one transaction. On any error the data is
    rolled back and a ``failed`` ``ingest_run`` row records the error instead.

    Args:
        con: Connection from ``houselens_pipeline.db.connect``.
        source_id: Source the frame came from.
        obs: Frame already validated by ``quality.schemas.validate_obs``.
        checksum: Checksum of the raw source file.
        run_date: Vintage date to stamp on inserted rows.

    Returns:
        The run outcome; exactly one ``ingest_run`` row is written per call.
    """
    run_id = str(uuid.uuid4())
    started_at = _now()
    con.begin()
    try:
        result = IngestResult(*_write(con, source_id, obs, checksum, run_date))
        _record_run(con, run_id, source_id, started_at, result, checksum)
        con.execute("drop table if exists _cand; drop table if exists _new")
        con.commit()
    except Exception as e:  # never raise for data problems; record the failure instead
        con.rollback()  # also discards the _new/_cand temp tables
        result = IngestResult("failed", 0, f"{type(e).__name__}: {e}")
        _record_run(con, run_id, source_id, started_at, result, checksum)
    return result
