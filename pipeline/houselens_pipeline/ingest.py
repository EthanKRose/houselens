"""Vintage writer: append canonical observations to DuckDB without overwriting history."""

import contextlib
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Literal

import duckdb
import polars as pl

Status = Literal["ok", "unchanged", "failed"]

# shortcut: a run that revises more existing rows than this fails, so one vendor re-estimating
# its whole ZIP history (~9M rows) cannot grow the DB by hundreds of MB unnoticed; when that
# happens for real, move ZIP data to its own DuckDB file in R2 (or keep only the months export
# uses) and raise this.
MAX_REVISED_ROWS = 2_000_000

# Rows that are new, or whose value/flags differ from observation_latest; `collides` marks rows
# whose (series, geo, period_start, run_date) key already exists (a same-day re-run).
# shortcut: a run_date earlier than the latest vintage is still compared against latest and its
# rows never become latest; upgrade if back-fills are ever needed.
_CANDIDATES = """
create or replace temp table _cand as
select n.*, exists (
    select 1 from observation o
    where o.series_id = n.series_id and o.geo_id = n.geo_id
      and o.period_start = n.period_start and o.vintage_date = $run_date
) as collides, l.series_id is not null as revised
from _new n left join observation_latest l using (series_id, geo_id, period_start)
where l.series_id is null
   or n.value is distinct from l.value
   or list_sort(n.quality_flags) is distinct from list_sort(l.quality_flags)
"""

# Per (series, geo level): a vanished metro file must not hide behind ZIP rows of the same
# series. Levels are the geo_id prefix (US, ST, CBSA, ZIP).
_COVERAGE = """
with n as (select series_id, split_part(geo_id, ':', 1) lvl, count(distinct geo_id) c
           from _new group by 1, 2),
     l as (select series_id, geo_id, period_start, split_part(geo_id, ':', 1) lvl,
                  max(period_start) over (partition by series_id, split_part(geo_id, ':', 1)) last
           from observation_latest where series_id in (select series_id from _new)),
     -- ZIPs: only the latest month counts; monthly ZIP files churn, so "every ZIP ever seen"
     -- would ratchet up until the check failed forever.
     cur as (select series_id, lvl, count(distinct geo_id) c from l
             where lvl <> 'ZIP' or period_start = last group by 1, 2)
select series_id || ' ' || lvl, coalesce(n.c, 0), cur.c from cur left join n using (series_id, lvl)
where coalesce(n.c, 0) < 0.95 * cur.c order by 1
"""

# This source's series that have current data but no rows at all in the new frame.
_ABSENT = """
select distinct l.series_id from observation_latest l join series s using (series_id)
where s.source_id = $source_id
  and not exists (select 1 from _new n where n.series_id = l.series_id)
order by 1
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
    if obs.is_empty():
        return "failed", 0, "empty frame: no observations to write"
    last = con.execute(
        "select file_checksum from ingest_run where source_id = ?"
        " and status in ('ok', 'unchanged') order by finished_at desc limit 1",
        [source_id],
    ).fetchall()
    if last and last[0][0] == checksum:
        return "unchanged", 0, f"checksum {checksum} matches last good run"

    # Arrow PyCapsule lets DuckDB read the Polars frame without a pyarrow dependency
    con.from_arrow(obs.__arrow_c_stream__()).query(
        "_src", "create or replace temp table _new as select * from _src"
    )
    # observation has no PK index (see schema.sql), so duplicate keys are refused here.
    [(dups,)] = con.execute(
        "select count(*) - count(distinct (series_id, geo_id, period_start)) from _new"
    ).fetchall()
    if dups:
        return "failed", 0, f"{dups} duplicate (series, geo, period) rows in the new frame"
    absent = [r[0] for r in con.execute(_ABSENT, {"source_id": source_id}).fetchall()]
    if absent:
        return "failed", 0, f"series absent from new frame: {', '.join(absent)}"
    drops = con.execute(_COVERAGE).fetchall()
    if drops:
        detail = "; ".join(f"{s}: {n} geos vs {c} in observation_latest" for s, n, c in drops)
        return "failed", 0, f"coverage drop >5%: {detail}"

    con.execute(_CANDIDATES, {"run_date": run_date})
    [(revised,)] = con.execute(
        "select count(*) from _cand where revised and not collides"
    ).fetchall()
    if revised > MAX_REVISED_ROWS:
        return "failed", 0, f"{revised} existing rows revised (limit {MAX_REVISED_ROWS})"
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

    0. An empty ``obs``, or one with duplicate ``(series_id, geo_id, period_start)`` keys, is
       ``failed`` with 0 rows.
    1. If the most recent ``ok``/``unchanged`` run for ``source_id`` (failed runs never count)
       has the same ``file_checksum``, the result is ``unchanged`` with 0 rows.
    2. For each series present in both ``obs`` and ``observation_latest``, and each geo level
       (``US``/``ST``/``CBSA``/``ZIP``), if the new distinct ``geo_id`` count is below 95% of
       the current one, the result is ``failed`` with 0 rows.
       Before that, any series of this source (``series.source_id``) with rows in
       ``observation_latest`` but none in ``obs`` is ``failed`` with 0 rows.
    3. A row is inserted with ``vintage_date = run_date`` only if its
       ``(series_id, geo_id, period_start)`` is new, or its ``value`` (exact float equality)
       or its ``quality_flags`` (order-insensitive) differ from ``observation_latest``; a flags
       change alone therefore creates a new vintage. A null ``release_date`` becomes
       ``run_date`` (first seen).
       If more than ``MAX_REVISED_ROWS`` of those rows revise an existing key, the result is
       ``failed`` with 0 rows.
    4. If a changed row's ``(series_id, geo_id, period_start, run_date)`` already exists (a
       same-day re-run), it is skipped and counted in the message; nothing is updated.

    All inserts and the ``ingest_run`` row share one transaction. On any error the data is
    rolled back and a ``failed`` ``ingest_run`` row records the original error instead, even
    when ``commit`` itself fails.

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
        # a failed commit has already ended the transaction, so rollback would raise
        with contextlib.suppress(duckdb.TransactionException):
            con.rollback()  # also discards the _new/_cand temp tables
        result = IngestResult("failed", 0, f"{type(e).__name__}: {e}")
        _record_run(con, run_id, source_id, started_at, result, checksum)
    return result
