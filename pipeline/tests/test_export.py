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
