from collections.abc import Iterator
from datetime import date

import duckdb
import polars as pl
import pytest

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
) -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                "series_id": "s",
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


def test_bad_frame_rolls_back_and_records_failure(con: duckdb.DuckDBPyConnection) -> None:
    dup = pl.concat([_obs(), _obs(n_geos=1)])  # duplicate PK inside one frame
    r = write_vintage(con, "src", dup, "a", D1)
    assert (r.status, r.rows_written) == ("failed", 0)
    assert "Constraint" in r.message
    assert _count(con) == 0
    assert _runs(con) == [("failed", "a", 0)]
