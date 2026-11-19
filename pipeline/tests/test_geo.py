from pathlib import Path

import polars as pl
import pytest

from houselens_pipeline.db import connect
from houselens_pipeline.geo import (
    load_geographies,
    load_overrides,
    msad_codes,
    normalize_name,
    resolve_regions,
    sync_geographies,
)

GEO = load_geographies()


def regions(*rows: tuple[str, str | None, str, str | None]) -> pl.DataFrame:
    return pl.DataFrame(
        rows,
        schema={"vendor_region_id": pl.String, "vendor_name": pl.String, "level": pl.String,
                "code": pl.String},
        orient="row",
    )  # fmt: skip


def geo_of(mapping: pl.DataFrame, vendor_region_id: str) -> str:
    return str(mapping.filter(pl.col("vendor_region_id") == vendor_region_id)["geo_id"].item())


def test_geographies_shape() -> None:
    assert GEO.columns == ["geo_id", "level", "name", "state_fips", "non_disclosure"]
    assert GEO.filter(pl.col("geo_id") == "US").height == 1
    assert GEO.filter(pl.col("geo_id").str.starts_with("ST:")).height == 51
    austin = GEO.filter(pl.col("geo_id") == "CBSA:12420")
    assert austin.height == 1 and austin["name"].item().startswith("Austin")
    assert GEO["geo_id"].is_unique().all()


def test_non_disclosure_flags() -> None:
    flagged = set(GEO.filter(pl.col("non_disclosure"))["geo_id"])
    assert {"ST:48", "ST:29"} <= flagged
    assert not {"ST:53", "ST:04"} & flagged
    assert len({g for g in flagged if g.startswith("ST:")}) == 12
    # a CBSA follows its first-listed state
    assert {"CBSA:12420", "CBSA:45500"} <= flagged  # TX, TX-AR
    assert not {"CBSA:35620", "CBSA:31140", "CBSA:36620"} & flagged  # NY-NJ, KY-IN, OR-ID


def test_msad_codes() -> None:
    assert "14454" in msad_codes()
    assert "CBSA:14454" not in set(GEO["geo_id"])


def test_normalize_name() -> None:
    assert normalize_name("Louisville/Jefferson County, KY-IN") == "louisville, ky"
    assert normalize_name("  New   York-Newark-Jersey City, NY-NJ") == "new york, ny"
    assert normalize_name("Austin, TX") == "austin, tx"


def test_zillow_style_names_resolve() -> None:
    r = resolve_regions(
        "zillow",
        regions(
            ("1", "Austin, TX", "CBSA", None),
            ("2", "Louisville, KY", "CBSA", None),
            ("3", "New York, NY", "CBSA", None),
            ("4", "United States", "US", None),
            ("5", "Texas", "ST", None),
        ),
    )
    m = r.mapping
    assert m.columns == ["source_id", "vendor_region_id", "vendor_name", "geo_id", "match_method"]
    assert r.unmatched.is_empty() and r.skipped_by_rule.is_empty()
    assert geo_of(m, "1") == "CBSA:12420"
    louisville = GEO.filter(pl.col("geo_id") == geo_of(m, "2"))["name"].item()
    assert louisville == "Louisville/Jefferson County, KY-IN"
    assert geo_of(m, "3") == "CBSA:35620"
    assert geo_of(m, "4") == "US"
    assert geo_of(m, "5") == "ST:48"
    methods = dict(zip(m["vendor_region_id"], m["match_method"], strict=True))
    assert methods == {"1": "name_fuzzy", "2": "name_fuzzy", "3": "name_fuzzy", "4": "fips",
                       "5": "fips"}  # fmt: skip


def test_code_match() -> None:
    r = resolve_regions("fred", regions(("a", "whatever", "CBSA", "12420")))
    assert r.mapping.rows() == [("fred", "a", "whatever", "CBSA:12420", "cbsa_code")]


def test_msad_skipped_not_unmatched() -> None:
    r = resolve_regions("fred", regions(("b", "Boston, MA", "CBSA", "14454")))
    assert r.skipped_by_rule["vendor_region_id"].to_list() == ["b"]
    assert r.unmatched.is_empty() and r.mapping.is_empty()


def test_unknown_region_reported() -> None:
    r = resolve_regions(
        "zillow", regions(("x", "Atlantis, ZZ", "CBSA", None), ("1", "Austin, TX", "CBSA", None))
    )
    assert r.unmatched["vendor_region_id"].to_list() == ["x"]
    assert "x" not in r.mapping["vendor_region_id"].to_list()


def test_override_wins() -> None:
    r = resolve_regions(
        "zillow",
        regions(("1", "Austin, TX", "CBSA", "12420"), ("x", "Atlantis, ZZ", "CBSA", None)),
        overrides={"zillow": {"1": "CBSA:35620", "x": "CBSA:12420"}, "other": {"x": "US"}},
    )
    assert sorted(r.mapping.select("vendor_region_id", "geo_id", "match_method").rows()) == [
        ("1", "CBSA:35620", "manual"),
        ("x", "CBSA:12420", "manual"),
    ]
    assert r.unmatched.is_empty()


def test_sync_geographies_roundtrip() -> None:
    con = connect(":memory:")
    sync_geographies(con)
    sync_geographies(con)
    assert con.execute("select count(*) from geography").fetchone() == (GEO.height,)
    assert con.execute("select non_disclosure from geography where geo_id='ST:48'").fetchone() == (
        True,
    )


def test_unknown_code_unmatched_no_name_fallback() -> None:
    name = "Washington-Arlington-Alexandria, DC-VA-MD-WV (MSAD)"
    r = resolve_regions("fred", regions(("w", name, "CBSA", "47894")))
    assert r.unmatched["vendor_region_id"].to_list() == ["w"]
    assert r.mapping.is_empty() and r.skipped_by_rule.is_empty()


def test_code_ignored_off_cbsa_level() -> None:
    r = resolve_regions("fred", regions(("t", "Texas", "ST", "12420")))
    assert r.mapping.select("geo_id", "match_method").rows() == [("ST:48", "fips")]


def test_bad_override_raises() -> None:
    with pytest.raises(ValueError, match=r"zillow/1 -> 'CBSA:00000'"):
        resolve_regions(
            "zillow", regions(("1", "Austin, TX", "CBSA", None)),
            overrides={"zillow": {"1": "CBSA:00000"}},
        )  # fmt: skip


def test_null_name() -> None:
    r = resolve_regions(
        "zillow",
        regions(("o", None, "CBSA", None), ("c", None, "CBSA", "12420"), ("n", None, "CBSA", None),
                ("s", None, "ST", None)),
        overrides={"zillow": {"o": "US"}},
    )  # fmt: skip
    assert sorted(r.mapping.select("vendor_region_id", "geo_id").rows()) == [
        ("c", "CBSA:12420"),
        ("o", "US"),
    ]
    assert sorted(r.unmatched["vendor_region_id"]) == ["n", "s"]


def test_realtor_codes_resolve() -> None:
    codes = set(
        pl.read_csv(Path(__file__).parent / "fixtures/realtor/metro.csv", infer_schema=False)[
            "cbsa_code"
        ]
    )
    r = resolve_regions("realtor", regions(*((c, None, "CBSA", c) for c in sorted(codes))))
    assert r.unmatched.is_empty() and r.skipped_by_rule.is_empty()
    assert r.mapping.height == len(codes)


def test_every_override_target_exists() -> None:
    targets = {g for m in load_overrides().values() for g in m.values()}
    assert targets and targets <= set(GEO["geo_id"])
