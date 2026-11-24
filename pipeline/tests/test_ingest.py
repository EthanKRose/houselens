from collections.abc import Iterator
from datetime import date

import duckdb
import polars as pl
import pytest

from houselens_pipeline import ingest
from houselens_pipeline.db import connect
from houselens_pipeline.ingest import write_vintage

D1, D2 = date(2026, 1, 15), date(2026, 2, 15)
SCHEMA: dict[str, pl.DataType | type[pl.DataType]] = {
    "series_id": pl.String,
    "geo_id": pl.String,
    "period_start": pl.Date,
    "period_end": pl.Date,
    "value": pl.Float64,
    "release_date": pl.Date,
    "quality_flags": pl.List(pl.String),
}


def _obs(
    n_geos: int = 3,
    value: float = 1.0,
    release_date: date | None = None,
    flags: list[str] | None = None,
    series_id: str = "s",
) -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                "series_id": series_id,
                "geo_id": f"CBSA:{i:05d}",
                "period_start": date(2025, 12, 1),
                "period_end": date(2025, 12, 31),
                "value": value,
                "release_date": release_date,
                "quality_flags": flags or [],
            }
            for i in range(n_geos)
        ],
        schema=SCHEMA,
    )


@pytest.fixture
def con() -> Iterator[duckdb.DuckDBPyConnection]:
    c = connect(":memory:")
    yield c
    c.close()


def _count(con: duckdb.DuckDBPyConnection, table: str = "observation") -> int:
    row = con.execute(f"select count(*) from {table}").fetchone()
    assert row is not None
    return int(row[0])


def _runs(con: duckdb.DuckDBPyConnection) -> list[tuple[object, ...]]:
    return con.execute(
        "select status, file_checksum, rows_written from ingest_run order by started_at"
    ).fetchall()


def test_first_ingest_writes_all(con: duckdb.DuckDBPyConnection) -> None:
    r = write_vintage(con, "src", _obs(), "a", D1)
    assert (r.status, r.rows_written) == ("ok", 3)
    assert _count(con) == 3
    assert _runs(con) == [("ok", "a", 3)]


def test_same_checksum_unchanged(con: duckdb.DuckDBPyConnection) -> None:
    write_vintage(con, "src", _obs(), "a", D1)
    r = write_vintage(con, "src", _obs(value=9.0), "a", D2)
    assert (r.status, r.rows_written) == ("unchanged", 0)
    assert _count(con) == 3
    assert _runs(con)[-1] == ("unchanged", "a", 0)


def test_new_checksum_same_values_writes_zero(con: duckdb.DuckDBPyConnection) -> None:
    write_vintage(con, "src", _obs(), "a", D1)
    r = write_vintage(con, "src", _obs(), "b", D2)
    assert (r.status, r.rows_written) == ("ok", 0)
    assert _count(con) == 3


def test_revised_value_adds_vintage(con: duckdb.DuckDBPyConnection) -> None:
    write_vintage(con, "src", _obs(), "a", D1)
    r = write_vintage(con, "src", _obs(value=2.0), "b", D2)
    assert (r.status, r.rows_written) == ("ok", 3)
    assert con.execute(
        "select distinct value, vintage_date from observation_latest"
    ).fetchall() == [(2.0, D2)]
    assert con.execute(
        "select count(*) from observation where value = 1.0 and vintage_date = ?", [D1]
    ).fetchall() == [(3,)]


def test_quality_flags_change_adds_vintage(con: duckdb.DuckDBPyConnection) -> None:
    write_vintage(con, "src", _obs(), "a", D1)
    r = write_vintage(con, "src", _obs(flags=["covid"]), "b", D2)
    assert r.rows_written == 3
    assert con.execute("select distinct quality_flags from observation_latest").fetchall() == [
        (["covid"],)
    ]


def test_coverage_drop_fails_and_writes_nothing(con: duckdb.DuckDBPyConnection) -> None:
    write_vintage(con, "src", _obs(n_geos=100), "a", D1)
    r = write_vintage(con, "src", _obs(n_geos=90, value=2.0), "b", D2)
    assert (r.status, r.rows_written) == ("failed", 0)
    assert "s" in r.message and "90" in r.message and "100" in r.message
    assert _count(con) == 100
    assert _runs(con)[-1] == ("failed", "b", 0)


def test_coverage_drop_within_tolerance_ok(con: duckdb.DuckDBPyConnection) -> None:
    write_vintage(con, "src", _obs(n_geos=100), "a", D1)
    assert write_vintage(con, "src", _obs(n_geos=95), "b", D2).status == "ok"


def test_failed_run_does_not_count_for_unchanged(con: duckdb.DuckDBPyConnection) -> None:
    write_vintage(con, "src", _obs(n_geos=100), "a", D1)
    write_vintage(con, "src", _obs(n_geos=10), "b", D2)
    assert write_vintage(con, "src", _obs(n_geos=100), "a", D2).status == "unchanged"


def test_null_release_date_becomes_run_date(con: duckdb.DuckDBPyConnection) -> None:
    write_vintage(con, "src", _obs(n_geos=1), "a", D1)
    write_vintage(con, "src", _obs(n_geos=1, value=2.0), "b", D2)
    write_vintage(con, "src", _obs(n_geos=1, value=3.0, release_date=D1), "c", D2 + D2.resolution)
    assert con.execute(
        "select vintage_date, release_date from observation order by vintage_date"
    ).fetchall() == [(D1, D1), (D2, D2), (D2 + D2.resolution, D1)]


def test_same_run_date_revision_skips_without_overwrite(
    con: duckdb.DuckDBPyConnection,
) -> None:
    write_vintage(con, "src", _obs(), "a", D1)
    r = write_vintage(con, "src", _obs(value=2.0), "b", D1)
    assert (r.status, r.rows_written) == ("ok", 0)
    assert "skipped 3" in r.message
    assert con.execute("select distinct value from observation").fetchall() == [(1.0,)]


def test_bad_frame_rolls_back_and_records_failure(
    con: duckdb.DuckDBPyConnection, monkeypatch: pytest.MonkeyPatch
) -> None:
    # any SQL error mid-write must roll back and be recorded, never raised
    monkeypatch.setattr(
        ingest,
        "_CANDIDATES",
        "create or replace temp table _cand as select error('boom') where $run_date is not null",
    )
    r = write_vintage(con, "src", _obs(), "a", D1)
    assert (r.status, r.rows_written) == ("failed", 0)
    assert "boom" in r.message
    assert _count(con) == 0
    assert _runs(con) == [("failed", "a", 0)]


class _CommitFails:
    """Connection proxy whose commit fails, as a conflicting writer would make it."""

    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self._con = con

    def __getattr__(self, name: str) -> object:
        return getattr(self._con, name)

    def commit(self) -> None:
        raise duckdb.TransactionException("commit failed: write-write conflict")


def test_commit_failure_records_original_error(con: duckdb.DuckDBPyConnection) -> None:
    r = write_vintage(_CommitFails(con), "src", _obs(), "a", D1)  # type: ignore[arg-type]
    assert (r.status, r.rows_written) == ("failed", 0)
    assert "write-write conflict" in r.message
    assert _runs(con) == [("failed", "a", 0)]
    assert _count(con) == 0  # rolled back


def test_empty_frame_fails(con: duckdb.DuckDBPyConnection) -> None:
    r = write_vintage(con, "src", _obs(n_geos=0), "a", D1)
    assert (r.status, r.rows_written) == ("failed", 0)
    assert "empty" in r.message
    assert _runs(con) == [("failed", "a", 0)]


def _catalog(con: duckdb.DuckDBPyConnection, series: dict[str, str]) -> None:
    con.execute("insert into metric (metric_id, label, unit) values ('m', 'M', 'index')")
    for src in sorted(set(series.values())):
        con.execute(
            "insert into source (source_id, name, publisher, license_note, access_method)"
            " values (?, 'n', 'p', 'l', 'api')",
            [src],
        )
    for sid, src in series.items():
        con.execute(
            "insert into series (series_id, source_id, metric_id, method_family, market,"
            " seasonal_adj, frequency, methodology_md) values (?, ?, 'm', 'median', 'sale',"
            " false, 'monthly', 'x')",
            [sid, src],
        )


def test_series_absent_from_frame_fails(con: duckdb.DuckDBPyConnection) -> None:
    _catalog(con, {"s": "src", "s2": "src", "x": "other"})
    write_vintage(con, "other", _obs(series_id="x"), "o", D1)
    both = pl.concat([_obs(), _obs(series_id="s2")])
    assert write_vintage(con, "src", both, "a", D1).status == "ok"  # "x" absent is fine
    r = write_vintage(con, "src", _obs(value=2.0), "b", D2)
    assert (r.status, r.rows_written) == ("failed", 0)
    assert "s2" in r.message and "absent" in r.message
    assert _count(con) == 9


def test_duplicate_keys_in_frame_fail_and_write_nothing(con: duckdb.DuckDBPyConnection) -> None:
    # observation has no PK index, so write_vintage itself must refuse duplicate keys.
    dup = pl.concat([_obs(n_geos=2), _obs(n_geos=1, value=9.0)])
    res = write_vintage(con, "src", dup, "c1", D1)
    assert res.status == "failed" and "duplicate" in res.message
    assert con.execute("select count(*) from observation").fetchone() == (0,)


def test_coverage_is_checked_per_geo_level(con: duckdb.DuckDBPyConnection) -> None:
    # A vanished metro file must not hide behind thousands of ZIP rows for the same series.
    zips = _obs(n_geos=50).with_columns(
        geo_id=pl.format("ZIP:{}", pl.int_range(50).cast(pl.String).str.zfill(5))
    )
    assert write_vintage(con, "src", pl.concat([_obs(n_geos=3), zips]), "a", D1).status == "ok"
    r = write_vintage(con, "src", zips.with_columns(value=pl.lit(2.0)), "b", D2)
    assert r.status == "failed" and "CBSA" in r.message, r.message


def test_zip_churn_in_monthly_files_does_not_ratchet_coverage(
    con: duckdb.DuckDBPyConnection,
) -> None:
    # Realtor.com's ZIP file holds one month; ZIPs come and go. Coverage must compare with the
    # latest month only, not every ZIP ever seen, or it fails forever once churn adds up.
    def month(m: int, first: int) -> pl.DataFrame:
        return pl.DataFrame(
            [
                {
                    "series_id": "s", "geo_id": f"ZIP:{z:05d}", "period_start": date(2026, m, 1),
                    "period_end": date(2026, m, 28), "value": 1.0, "release_date": None,
                    "quality_flags": [],
                }
                for z in range(first, first + 20)
            ],
            schema=SCHEMA,
        )  # fmt: skip

    for m in range(1, 6):  # each month drops one ZIP and adds a new one
        r = write_vintage(con, "src", month(m, m), f"c{m}", date(2026, m, 15))
        assert r.status == "ok", (m, r.message)
    # a real drop in the latest month still fails
    r = write_vintage(con, "src", month(6, 6).head(15), "c6", date(2026, 6, 15))
    assert r.status == "failed" and "ZIP" in r.message


def test_mass_revision_fails_and_writes_nothing(
    con: duckdb.DuckDBPyConnection, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ingest, "MAX_REVISED_ROWS", 2)
    assert write_vintage(con, "src", _obs(), "a", D1).status == "ok"  # new rows never count
    r = write_vintage(con, "src", _obs(value=2.0), "b", D2)
    assert (r.status, r.rows_written) == ("failed", 0)
    assert "3 existing rows revised" in r.message
    assert _count(con) == 3
