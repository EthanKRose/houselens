"""DuckDB connection helper that applies the canonical schema."""

from importlib import resources
from pathlib import Path

import duckdb


def connect(path: str | Path) -> duckdb.DuckDBPyConnection:
    """Open a DuckDB database and create the canonical schema if missing.

    Args:
        path: Database file path, or ``":memory:"``.

    Returns:
        An open connection with all tables and the ``observation_latest`` view.
    """
    con = duckdb.connect(str(path))
    con.execute(_SCHEMA)
    _drop_observation_pk(con)
    return con


_SCHEMA = resources.files("houselens_pipeline").joinpath("schema.sql").read_text("utf-8")
_COLS = (
    "series_id, geo_id, period_start, period_end, value, vintage_date, release_date,"
    " is_derived, quality_flags"
)


def _drop_observation_pk(con: duckdb.DuckDBPyConnection) -> None:
    """One-time migration: rebuild ``observation`` without its PRIMARY KEY index.

    Copies every row inside one transaction and aborts (leaving the old table) unless the row
    counts match. Databases created from the current schema have no PK and are left alone.
    """
    [(has_pk,)] = con.execute(
        "select count(*) from duckdb_constraints()"
        " where table_name = 'observation' and constraint_type = 'PRIMARY KEY'"
    ).fetchall()
    if not has_pk:
        return
    con.begin()
    try:
        con.execute("drop view observation_latest; alter table observation rename to _obs_old")
        con.execute(_SCHEMA)
        con.execute(f"insert into observation ({_COLS}) select {_COLS} from _obs_old")
        [(old, new)] = con.execute(
            "select (select count(*) from _obs_old), (select count(*) from observation)"
        ).fetchall()
        if old != new:
            raise RuntimeError(f"observation migration copied {new} of {old} rows")
        con.execute("drop table _obs_old")
        con.commit()
    except BaseException:
        con.rollback()
        raise
