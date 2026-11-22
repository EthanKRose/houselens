import dataclasses
import json
import shutil
from datetime import date
from pathlib import Path

import polars as pl
import pytest

from houselens_pipeline import cli
from houselens_pipeline.adapters.fhfa import FhfaAdapter
from houselens_pipeline.catalog import load_catalog
from houselens_pipeline.db import connect

FIXTURES = Path(__file__).parent / "fixtures"
D1 = date(2026, 1, 15)
SOURCES = ["fred", "fhfa", "zillow", "realtor"]


@pytest.fixture(autouse=True)
def _no_fred_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FRED_API_KEY", raising=False)


def _runs(db: Path) -> dict[str, tuple[str, int, str]]:
    con = connect(db)
    rows = con.execute(
        "select source_id, status, rows_written, message from ingest_run order by finished_at"
    ).fetchall()
    con.close()
    return {s: (st, n, m) for s, st, n, m in rows}


def _run(
    tmp_path: Path,
    input_dir: Path = FIXTURES,
    sources: list[str] = SOURCES,
    max_unmatched: float = 0.2,  # the Zillow fixture's Lamesa is 1 of 8 regions
) -> int:
    return cli.run(
        tmp_path / "t.duckdb",
        sources,
        D1,
        input_dir,
        tmp_path / "reports",
        max_unmatched=max_unmatched,
    )


def test_fixture_run_ingests_all_enabled(tmp_path: Path) -> None:
    assert _run(tmp_path) == 0
    runs = _runs(tmp_path / "t.duckdb")
    for s in SOURCES:
        assert runs[s][0] == "ok" and runs[s][1] > 0, (s, runs[s])
    con = connect(tmp_path / "t.duckdb")
    [(n,)] = con.execute(
        "select count(*) from vendor_geo_map where source_id = 'zillow'"
    ).fetchall()
    [(lamesa,)] = con.execute(
        "select count(*) from observation o join series s using (series_id)"
        " where s.source_id = 'zillow' and o.geo_id is null"
    ).fetchall()
    assert n > 0 and lamesa == 0


def test_rerun_unchanged(tmp_path: Path) -> None:
    assert _run(tmp_path) == 0
    assert _run(tmp_path) == 0
    con = connect(tmp_path / "t.duckdb")
    last = con.execute(
        "select source_id, status, rows_written from ingest_run"
        " qualify row_number() over (partition by source_id order by finished_at desc) = 1"
    ).fetchall()
    assert {s: (st, n) for s, st, n in last} == {s: ("unchanged", 0) for s in SOURCES}


def test_config_change_defeats_unchanged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert _run(tmp_path) == 0
    edited = {**cli._config_bytes(), "known_events.yaml": b"[]\n"}
    monkeypatch.setattr(cli, "_config_bytes", lambda: edited)
    assert _run(tmp_path) == 0
    assert {s: st for s, (st, _, _) in _runs(tmp_path / "t.duckdb").items()} == {
        s: "ok" for s in SOURCES
    }


def test_one_failing_source_isolated(tmp_path: Path) -> None:
    broken = tmp_path / "in"
    shutil.copytree(FIXTURES, broken)
    (broken / "fhfa" / "hpi_master.csv").write_text("not,a,valid\nfile\n")
    assert _run(tmp_path, broken) == 1
    runs = _runs(tmp_path / "t.duckdb")
    assert runs["fhfa"][0] == "failed"
    assert runs["zillow"][0] == "ok" and runs["zillow"][1] > 0


def test_redfin_missing_input_fails_cleanly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cat = load_catalog()
    enabled = tuple(dataclasses.replace(s, enabled=True) for s in cat.sources)
    monkeypatch.setattr(cli, "load_catalog", lambda: dataclasses.replace(cat, sources=enabled))
    assert _run(tmp_path, sources=[*SOURCES, "redfin"]) == 1
    runs = _runs(tmp_path / "t.duckdb")
    assert runs["redfin"][0] == "failed" and "manual input missing" in runs["redfin"][2]
    for s in SOURCES:
        assert runs[s][0] == "ok", (s, runs[s])


def test_unmatched_report_written(tmp_path: Path) -> None:
    _run(tmp_path)
    report = json.loads((tmp_path / "reports" / "unmatched_zillow.json").read_text())
    assert [r["vendor_name"] for r in report["unmatched"]] == ["Lamesa, TX"]
    fhfa = json.loads((tmp_path / "reports" / "unmatched_fhfa.json").read_text())
    assert len(fhfa["skipped_by_rule"]) == 1


def test_unmatched_over_threshold_fails_source(tmp_path: Path) -> None:
    assert _run(tmp_path, max_unmatched=cli.MAX_UNMATCHED_SHARE) == 1
    runs = _runs(tmp_path / "t.duckdb")
    assert runs["zillow"][0] == "failed" and "unmatched" in runs["zillow"][2]
    assert runs["fhfa"][0] == "ok"
    assert (tmp_path / "reports" / "unmatched_zillow.json").exists()


def test_fred_without_key_fails_when_fetching(tmp_path: Path) -> None:
    other = tmp_path / "in"
    shutil.copytree(FIXTURES, other)
    shutil.rmtree(other / "fred")
    assert _run(tmp_path, other) == 1
    runs = _runs(tmp_path / "t.duckdb")
    assert runs["fred"][0] == "failed" and "FRED_API_KEY" in runs["fred"][2]
    assert runs["fhfa"][0] == "ok"


def test_main_parses_args(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    db = tmp_path / "m.duckdb"
    argv = ["ingest", "--db", str(db), "--sources", "fhfa", "--run-date", "2026-01-15"]
    argv += ["--input-dir", str(FIXTURES), "--report-dir", str(tmp_path / "r")]
    assert cli.main(argv) == 0
    out = capsys.readouterr().out
    assert out.startswith("fhfa: ok") and set(_runs(db)) == {"fhfa"}
    assert out.rstrip().endswith("unmatched=0 skipped_by_rule=1 (input-dir)")
    zargv = ["ingest", "--db", str(db), "--sources", "zillow", "--input-dir", str(FIXTURES)]
    zargv += ["--report-dir", str(tmp_path / "r"), "--max-unmatched-share", "0.2"]
    assert cli.main(zargv) == 0


def test_polars_panic_isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def panic(*_: object) -> None:
        raise pl.exceptions.PanicException("boom")

    monkeypatch.setattr(FhfaAdapter, "parse", panic)
    assert _run(tmp_path) == 1
    runs = _runs(tmp_path / "t.duckdb")
    assert runs["fhfa"][0] == "failed" and "boom" in runs["fhfa"][2]
    assert runs["zillow"][0] == "ok" and runs["zillow"][1] > 0


def test_crash_exits_2(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_: object, **__: object) -> None:
        raise RuntimeError("db exploded")

    monkeypatch.setattr(cli, "connect", boom)
    argv = ["ingest", "--db", str(tmp_path / "c.duckdb"), "--sources", "fhfa"]
    assert cli.main(argv) == 2
    assert cli.main(["export", "--db", str(tmp_path / "c.duckdb"), "--out", str(tmp_path)]) == 2


def _fhfa_points(out: Path) -> dict[str, list[object]]:
    got: dict[str, list[object]] = {}
    for p in sorted(out.rglob("*.json")):
        series = json.loads(p.read_text()).get("series", {}) if p.parent.name == "geo" else {}
        got |= {f"{p.name}:{k}": v["points"] for k, v in series.items() if k.startswith("fhfa.")}
    return got


def test_broken_part_keeps_earlier_vintage_in_export(tmp_path: Path) -> None:
    db = str(tmp_path / "t.duckdb")
    assert _run(tmp_path) == 0
    assert cli.main(["export", "--db", db, "--out", str(tmp_path / "before")]) == 0
    broken = tmp_path / "in"
    shutil.copytree(FIXTURES, broken)
    (broken / "fhfa" / "hpi_master.csv").write_text("not,a,valid\nfile\n")
    assert _run(tmp_path, broken) == 1
    assert cli.main(["export", "--db", db, "--out", str(tmp_path / "after")]) == 0
    before = _fhfa_points(tmp_path / "before")
    assert before and _fhfa_points(tmp_path / "after") == before
