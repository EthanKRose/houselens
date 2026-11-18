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
    con.execute(resources.files("houselens_pipeline").joinpath("schema.sql").read_text("utf-8"))
    return con
