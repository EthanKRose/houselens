"""Canonical geographies: the US, 50 states + DC, and every 2023 CBSA (metro and micro)."""

from importlib import resources

import duckdb
import polars as pl

NON_DISCLOSURE_USPS = frozenset(
    {"AK", "ID", "KS", "LA", "MS", "MO", "MT", "NM", "ND", "TX", "UT", "WY"}
)


def _csv(name: str) -> pl.DataFrame:
    data = resources.files("houselens_pipeline.geo").joinpath("data", name).read_bytes()
    return pl.read_csv(data, infer_schema=False)  # all strings: keeps FIPS leading zeros


def load_geographies() -> pl.DataFrame:
    """Load the canonical geography rows.

    Returns:
        Columns ``geo_id, level, name, state_fips, non_disclosure``: one ``US`` row, one
        ``ST:{fips}`` row per state and DC, and one ``CBSA:{code}`` row per CBSA.
    """
    states = _csv("states.csv")
    cbsa = _csv("cbsa.csv")
    return pl.concat(
        [
            pl.DataFrame(
                {
                    "geo_id": ["US"],
                    "level": ["US"],
                    "name": ["United States"],
                    "state_fips": [None],
                    "non_disclosure": [False],
                },
                schema_overrides={"state_fips": pl.String},
            ),  # fmt: skip
            states.select(
                geo_id="ST:" + pl.col("fips"),
                level=pl.lit("ST"),
                name="name",
                state_fips="fips",
                non_disclosure=pl.col("usps").is_in(NON_DISCLOSURE_USPS),
            ),
            cbsa.select(
                geo_id="CBSA:" + pl.col("cbsa_code"),
                level=pl.lit("CBSA"),
                name="title",
                state_fips=pl.lit(None, pl.String),  # CBSAs can span states
                non_disclosure=pl.lit(False),
            ),
        ]
    )


def msad_codes() -> frozenset[str]:
    """Return the 2023 Metropolitan Division (MSAD) codes, which are not canonical geographies.

    Returns:
        Five-digit MSAD codes.
    """
    return frozenset(_csv("msad.csv")["msad_code"])


def sync_geographies(con: duckdb.DuckDBPyConnection) -> None:
    """Upsert every canonical geography into the ``geography`` table.

    Args:
        con: Connection with the canonical schema applied.
    """
    con.executemany(
        "INSERT OR REPLACE INTO geography (geo_id, level, name, state_fips, non_disclosure)"
        " VALUES (?,?,?,?,?)",
        load_geographies().rows(),
    )


def msad_cbsa_codes() -> frozenset[str]:
    """Return the CBSA codes that contain at least one Metropolitan Division.

    Returns:
        Five-digit CBSA codes.
    """
    return frozenset(_csv("msad.csv")["cbsa_code"])
