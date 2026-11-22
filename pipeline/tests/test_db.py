from datetime import date
from pathlib import Path

from houselens_pipeline.db import connect

TABLES = {
    "source", "metric", "series", "geography", "geo_crosswalk",
    "vendor_geo_map", "observation", "ingest_run", "discrepancy", "observation_latest",
}  # fmt: skip


def test_schema_tables() -> None:
    con = connect(":memory:")
    rows = con.execute("select table_name from information_schema.tables").fetchall()
    assert {r[0] for r in rows} == TABLES


def test_connect_twice_is_idempotent(tmp_path: Path) -> None:
    connect(tmp_path / "a.duckdb").close()
    connect(tmp_path / "a.duckdb").close()


def test_latest_view_picks_max_vintage() -> None:
    con = connect(":memory:")
    for v, val in ((date(2026, 1, 1), 1.0), (date(2026, 2, 1), 2.0)):
        con.execute(
            "insert into observation (series_id, geo_id, period_start, period_end, value,"
            " vintage_date) values ('s','g','2025-12-01','2025-12-31',?,?)",
            [val, v],
        )
    assert con.execute("select value from observation_latest").fetchall() == [(2.0,)]


def _has_obs_pk(con: object) -> bool:
    return bool(
        con.execute(  # type: ignore[attr-defined]
            "select count(*) from duckdb_constraints()"
            " where table_name = 'observation' and constraint_type = 'PRIMARY KEY'"
        ).fetchone()[0]
    )


def test_observation_has_no_pk_index() -> None:
    # A PK index on observation was ~5x the data (630 MB vs 118 MB for 9M ZIP rows).
    assert not _has_obs_pk(connect(":memory:"))


def test_old_db_migrates_keeping_every_row(tmp_path: Path) -> None:
    import duckdb

    db = tmp_path / "old.duckdb"
    old = duckdb.connect(str(db))
    old.execute(
        "create table observation (series_id TEXT, geo_id TEXT, period_start DATE NOT NULL,"
        " period_end DATE NOT NULL, value DOUBLE, vintage_date DATE NOT NULL, release_date DATE,"
        " is_derived BOOLEAN DEFAULT FALSE, quality_flags TEXT[],"
        " PRIMARY KEY (series_id, geo_id, period_start, vintage_date))"
    )
    old.execute(
        "insert into observation values ('s','g','2025-12-01','2025-12-31',1.5,'2026-01-01',"
        " null, false, ['f']), ('s','g','2025-12-01','2025-12-31',2.5,'2026-02-01',"
        " '2026-02-01', false, [])"
    )
    old.close()
    con = connect(db)
    assert not _has_obs_pk(con)
    assert con.execute("select count(*), sum(value) from observation").fetchone() == (2, 4.0)
    assert con.execute("select value, quality_flags from observation_latest").fetchall() == [
        (2.5, [])
    ]
    con.close()
    connect(db).close()  # second open: nothing left to migrate
