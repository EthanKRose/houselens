"""Canonical geographies: the US, 50 states + DC, every 2023 CBSA, and ZIP codes (ZCTAs)."""

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
        ``ST:{fips}`` row per state and DC, one ``CBSA:{code}`` row per CBSA, and one
        ``ZIP:{zcta}`` row per 2020 ZCTA in the 50 states + DC, named like
        ``"78704 · Travis County, TX"``.
    """
    states = _csv("states.csv")
    cbsa = _csv("cbsa.csv")
    zips = _zips(states)
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
                # the first (principal) state in the title decides, e.g. "Louisville, KY-IN" -> KY
                non_disclosure=pl.col("title")
                .str.extract(r", ([A-Z]{2})(?:-[A-Z]{2})*$")
                .is_in(NON_DISCLOSURE_USPS),
            ),
            zips.select(
                geo_id="ZIP:" + pl.col("zip"),
                level=pl.lit("ZIP"),
                name=pl.col("zip") + " · " + pl.col("county_name") + ", " + pl.col("usps"),
                state_fips="state_fips",
                non_disclosure=pl.col("usps").is_in(NON_DISCLOSURE_USPS),
            ),
        ]
    )


def _zips(states: pl.DataFrame) -> pl.DataFrame:
    # Inner join drops ZCTAs outside the 50 states + DC (e.g. Puerto Rico).
    return (
        _csv("zip.csv")
        .with_columns(state_fips=pl.col("county_fips").str.slice(0, 2))
        .join(states.select(state_fips="fips", usps="usps"), on="state_fips")
    )


def zip_parents() -> dict[str, tuple[str, str | None]]:
    """Map each canonical ZIP to its county name and metro ``geo_id``.

    shortcut: Connecticut ZIPs have no metro (2020 counties vs 2023 planning regions); fill in
    from a planning-region crosswalk if CT metro fallback matters.

    Returns:
        ``{"78704": ("Travis County", "CBSA:12420")}``; the metro is None outside any CBSA.
    """
    return {
        z: (county, f"CBSA:{c}" if c else None)
        for z, county, c in _zips(_csv("states.csv"))
        .select("zip", "county_name", "cbsa_code")
        .rows()
    }


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
    # One bulk insert: executemany is row-by-row and took ~45 s for the ~34k ZIP rows.
    con.from_arrow(load_geographies().__arrow_c_stream__()).query(
        "_geo",
        "insert or replace into geography (geo_id, level, name, state_fips, non_disclosure)"
        " select geo_id, level, name, state_fips, non_disclosure from _geo",
    )


def msad_cbsa_codes() -> frozenset[str]:
    """Return the CBSA codes that contain at least one Metropolitan Division.

    Returns:
        Five-digit CBSA codes.
    """
    return frozenset(_csv("msad.csv")["cbsa_code"])
