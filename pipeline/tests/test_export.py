import json
from datetime import date
from pathlib import Path

import pytest

from houselens_pipeline import cli
from houselens_pipeline.catalog import load_catalog
from houselens_pipeline.db import connect
from houselens_pipeline.export import export_site_data

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def out(tmp_path_factory: pytest.TempPathFactory) -> Path:
    base = tmp_path_factory.mktemp("export")
    db = base / "f.duckdb"
    cli.run(db, ["fred", "fhfa", "zillow", "realtor"], date(2026, 1, 15),
            FIXTURES, base / "rep", max_unmatched=0.2)  # fmt: skip
    con = connect(db)
    export_site_data(con, base / "site", load_catalog())
    con.close()
    return base / "site"


def _boom(c: str) -> None:
    raise ValueError(c)


def _load(p: Path) -> object:
    return json.loads(p.read_text(), parse_constant=_boom)


def test_files_written(out: Path) -> None:
    for f in ("catalog.json", "geographies.json", "freshness.json"):
        assert (out / f).is_file()
    cat = _load(out / "catalog.json")
    assert isinstance(cat, dict)
    assert set(cat) == {"sources", "metrics", "series", "known_events"}


def test_geo_filename_escaped(out: Path) -> None:
    assert (out / "geo" / "CBSA_12420.json").is_file()


def test_no_nan_anywhere(out: Path) -> None:
    files = list(out.rglob("*.json"))
    assert len(files) > 3
    for f in files:
        _load(f)


def test_national_only_flag(out: Path) -> None:
    cat = _load(out / "catalog.json")
    assert isinstance(cat, dict)
    flags = {s["series_id"]: s["national_only"] for s in cat["series"]}
    assert flags["fred.pmms.30y.nsa"] is True
    assert flags["zillow.zhvi.all.mid.sa"] is False


def test_disabled_source_absent(out: Path) -> None:
    for f in out.rglob("*.json"):
        assert "redfin" not in f.read_text()


def test_geo_file_under_200kb(out: Path) -> None:
    assert all(f.stat().st_size < 200_000 for f in (out / "geo").glob("*.json"))


def test_austin_has_zhvi_fhfa_realtor_not_cs(out: Path) -> None:
    geo = _load(out / "geo" / "CBSA_12420.json")
    assert isinstance(geo, dict)
    ids = set(geo["series"])
    assert "zillow.zhvi.all.mid.sa" in ids
    assert any(s.startswith("fhfa.") for s in ids)
    assert any(s.startswith("realtor.") for s in ids)
    assert not any(s.startswith("fred.cs.") for s in ids)
    pts = next(iter(geo["series"].values()))["points"]
    assert pts == sorted(pts, key=lambda p: p[0])


def test_stale_geo_files_removed(out: Path) -> None:
    (out / "geo" / "OLD_1.json").write_text("{}")
    con = connect(out.parent / "f.duckdb")
    export_site_data(con, out, load_catalog())
    con.close()
    assert not (out / "geo" / "OLD_1.json").exists()


def test_geographies_and_freshness_shape(out: Path) -> None:
    geos = _load(out / "geographies.json")
    assert isinstance(geos, list)
    for g in geos:
        assert set(g) == {
            "geo_id", "level", "name", "state_fips", "non_disclosure", "has_msad", "series_ids"
        }  # fmt: skip
        assert g["series_ids"]
    assert next(g for g in geos if g["geo_id"] == "CBSA:12420")["has_msad"] is False
    fresh = _load(out / "freshness.json")
    assert isinstance(fresh, dict) and fresh
    for f in fresh.values():
        assert set(f) == {
            "last_period_end", "last_release_date", "last_ingest_at", "frequency",
            "typical_lag_days",
        }  # fmt: skip


def test_has_msad_true_for_new_york(out: Path) -> None:
    geos = _load(out / "geographies.json")
    assert isinstance(geos, list)
    assert next(g for g in geos if g["geo_id"] == "CBSA:35620")["has_msad"] is True


def test_zips_stay_out_of_metro_files(out: Path) -> None:
    geos = _load(out / "geographies.json")
    assert isinstance(geos, list)
    assert not [g for g in geos if g["level"] == "ZIP"]
    assert not list((out / "geo").glob("ZIP_*.json"))


def test_series_levels_listed(out: Path) -> None:
    cat = _load(out / "catalog.json")
    assert isinstance(cat, dict)
    lv = {s["series_id"]: s["levels"] for s in cat["series"]}
    assert lv["zillow.zhvi.b3.mid.sa"] == ["ZIP"]
    assert lv["zillow.zhvi.all.mid.sa"] == ["CBSA", "ST", "US", "ZIP"]


def test_zip_shard(out: Path) -> None:
    shard = _load(out / "zip" / "787.json")
    assert isinstance(shard, dict)
    z = shard["78704"]
    assert z["name"] == "78704 · Travis County, TX"
    assert z["cbsa"] == "CBSA:12420" and z["non_disclosure"] is True
    zhvi = z["series"]["zillow.zhvi.all.mid.sa"]
    assert set(zhvi) == {
        "start",
        "end",
        "value",
        "y1",
        "y5",
        "vintage_date",
        "release_date",
        "flags",
    }
    assert zhvi["y1"] is not None and zhvi["y5"] is not None  # ZIP history kept from 2019
    ppsf = z["series"]["realtor.median_list_ppsf.all.nsa"]
    assert (ppsf["end"], ppsf["value"], ppsf["y1"]) == ("2026-10-31", 512.0, None)
    nj = _load(out / "zip" / "087.json")
    assert isinstance(nj, dict) and set(nj) == {"08701"}
    assert sorted(p.name for p in (out / "zip").glob("*.json")) == [
        "087.json",
        "100.json",
        "787.json",
    ]
