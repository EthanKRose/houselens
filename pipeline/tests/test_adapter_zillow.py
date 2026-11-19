from datetime import date
from pathlib import Path

import httpx

from houselens_pipeline.adapters.base import AdapterOutput, read_parts
from houselens_pipeline.adapters.zillow import ZillowAdapter
from houselens_pipeline.catalog import load_catalog

FIX = Path(__file__).parent / "fixtures" / "zillow"


def _out() -> AdapterOutput:
    return ZillowAdapter().parse(read_parts(FIX), load_catalog())


def test_unpivot_month_periods() -> None:
    obs = _out().obs.filter(series_id="zillow.zori.all.sa", vendor_region_id="394355")
    row = obs.filter(period_end=date(2026, 9, 30))
    assert row["period_start"].to_list() == [date(2026, 9, 1)]
    assert obs.filter(period_end=date(2026, 2, 28))["period_start"].to_list() == [date(2026, 2, 1)]


def test_region_levels() -> None:
    reg = {r["vendor_region_id"]: r for r in _out().regions.to_dicts()}
    assert reg["102001"]["level"] == "US" and reg["102001"]["code"] is None
    assert reg["54"] == {
        "vendor_region_id": "54",
        "vendor_name": "Texas",
        "level": "ST",
        "code": None,
    }
    assert reg["394355"]["level"] == "CBSA" and reg["394355"]["code"] is None
    assert reg["394355"]["vendor_name"] == "Austin, TX"


def test_blank_cells_skipped() -> None:
    obs = _out().obs.filter(series_id="zillow.zhvi.all.mid.sa", vendor_region_id="394767")
    assert obs.height == 13
    assert date(2025, 12, 1) not in obs["period_start"].to_list()
    assert obs["value"].null_count() == 0


def test_series_ids_from_part() -> None:
    obs = _out().obs
    assert set(obs["series_id"].unique()) == {"zillow.zhvi.all.mid.sa", "zillow.zori.all.sa"}
    zori = obs.filter(series_id="zillow.zori.all.sa")
    assert "54" not in zori["vendor_region_id"].to_list()
    assert "quality_flags" not in obs.columns


def test_fetch_urls() -> None:
    urls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        urls.append(str(req.url))
        return httpx.Response(200, content=b"x")

    parts = ZillowAdapter(httpx.Client(transport=httpx.MockTransport(handler))).fetch()
    assert set(parts) == {"zhvi_metro.csv", "zhvi_state.csv", "zori_metro.csv"}
    assert all(u.startswith("https://files.zillowstatic.com/research/public_csvs/") for u in urls)
    assert any(u.endswith("zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv") for u in urls)
