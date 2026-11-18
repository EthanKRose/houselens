import logging
from datetime import date
from pathlib import Path

import httpx
import pytest

from houselens_pipeline.adapters.base import AdapterOutput, checksum, read_parts
from houselens_pipeline.adapters.fred import FredAdapter
from houselens_pipeline.catalog import load_catalog

FIX = Path(__file__).parent / "fixtures" / "fred"


def _out() -> AdapterOutput:
    return FredAdapter("k").parse(read_parts(FIX), load_catalog())


def test_parse_skips_missing() -> None:
    obs = _out().obs.filter(series_id="fred.cs.national.sa")
    assert obs["period_start"].to_list() == [date(2026, 6, 1), date(2026, 8, 1)]
    assert obs["vendor_region_id"].unique().to_list() == ["US"]


def test_weekly_period() -> None:
    row = _out().obs.filter(series_id="fred.pmms.30y.nsa").filter(period_end=date(2026, 11, 12))
    assert row["period_start"].to_list() == [date(2026, 11, 6)]
    assert row["value"].to_list() == [6.1]


def test_metro_maps_cbsa() -> None:
    out = _out()
    obs = out.obs.filter(series_id="fred.cs.metro.sa")
    assert obs.height == 3
    assert obs["vendor_region_id"].unique().to_list() == ["12060"]
    reg = out.regions.filter(level="CBSA")
    assert reg.to_dicts() == [
        {"vendor_region_id": "12060", "vendor_name": "ATXRSA", "level": "CBSA", "code": "12060"}
    ]
    us = out.regions.filter(level="US")
    assert us["code"].to_list() == [None]


def test_release_date_from_realtime_start() -> None:
    obs = _out().obs.filter(series_id="fred.cs.national.sa")
    assert obs["release_date"].unique().to_list() == [date(2026, 10, 28)]


def test_fetch_builds_urls(caplog: pytest.LogCaptureFixture) -> None:
    urls: list[httpx.URL] = []

    def handler(req: httpx.Request) -> httpx.Response:
        urls.append(req.url)
        return httpx.Response(200, content=b'{"observations": []}')

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with caplog.at_level(logging.DEBUG):
        parts = FredAdapter("SECRETKEY", client=client).fetch()
    ids = {u.params["series_id"] for u in urls}
    expected = {
        k.split("=")[0]
        for key in load_catalog().series_by_vendor_key("fred")
        for k in key.split("|")
    }
    assert ids == expected and "CSUSHPISA" in ids and "ATXRSA" in ids
    assert set(parts) == {f"{i}.json" for i in ids}
    assert all(u.params["file_type"] == "json" for u in urls)
    assert "SECRETKEY" not in caplog.text


def test_fetch_error_redacts_key() -> None:
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    with pytest.raises(RuntimeError) as e:
        FredAdapter("SECRETKEY", client=client).fetch()
    assert "SECRETKEY" not in str(e.value) and "SECRETKEY" not in repr(e.value.__cause__)


def test_checksum_stable() -> None:
    assert checksum({"b": b"2", "a": b"1"}) == checksum({"a": b"1", "b": b"2"})
