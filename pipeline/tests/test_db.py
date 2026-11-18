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
