from houselens_pipeline.catalog import load_catalog, sync_catalog
from houselens_pipeline.db import connect

CAT = load_catalog()


def test_every_series_documented() -> None:
    sources = {s.source_id: s for s in CAT.sources}
    for s in CAT.series:
        assert s.methodology_md.strip(), s.series_id
        assert sources[s.source_id].license_note.strip()
        assert sources[s.source_id].attribution.strip()


def test_references_resolve() -> None:
    sids = {s.source_id for s in CAT.sources}
    mids = {m.metric_id for m in CAT.metrics}
    assert all(s.source_id in sids and s.metric_id in mids for s in CAT.series)


def test_series_ids_unique() -> None:
    ids = [s.series_id for s in CAT.series]
    assert len(ids) == len(set(ids))


def test_sa_suffix_matches_flag() -> None:
    for s in CAT.series:
        if s.series_id.endswith(".nsa"):
            assert not s.seasonal_adj
        elif s.series_id.endswith(".sa"):
            assert s.seasonal_adj


def test_sync_catalog_roundtrip() -> None:
    con = connect(":memory:")
    sync_catalog(con, CAT)
    sync_catalog(con, CAT)
    assert con.execute("select count(*) from series").fetchone() == (len(CAT.series),)
    assert len(CAT.series_by_vendor_key("fred")) == len(
        [s for s in CAT.series if s.source_id == "fred"]
    )


def test_fred_metro_vendor_key_pairs() -> None:
    key = CAT.series_by_vendor_key("fred")
    (metro,) = [s for s in key.values() if s.series_id == "fred.cs.metro.sa"]
    pairs = [p.split("=") for p in metro.vendor_key.split("|")]
    assert len(pairs) == 20
    assert all(len(p) == 2 and p[1].isdigit() and len(p[1]) == 5 for p in pairs)


def test_fred_dates_are_first_seen() -> None:
    # no realtime params are sent, so realtime_start is the request date, not a publication date
    assert {s.release_date_kind for s in CAT.series if s.source_id == "fred"} == {"first_seen"}


def test_series_have_unique_names_and_summaries() -> None:
    names = [s.name for s in CAT.series]
    assert len(names) == len(set(names))
    assert all(s.name.strip() and s.summary.strip() for s in CAT.series)
