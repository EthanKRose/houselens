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
    assert set(obs["series_id"].unique()) == {
        "zillow.zhvi.all.mid.sa",
        "zillow.zori.all.sa",
        *(f"zillow.zhvi.b{b}.mid.sa" for b in range(1, 6)),
    }
    zori = obs.filter(series_id="zillow.zori.all.sa")
    assert "54" not in zori["vendor_region_id"].to_list()
    assert "quality_flags" not in obs.columns


def test_fetch_urls() -> None:
    urls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        urls.append(str(req.url))
        return httpx.Response(200, content=b"x")

    parts = ZillowAdapter(httpx.Client(transport=httpx.MockTransport(handler))).fetch()
    assert set(parts) == {
        "zhvi_metro.csv",
        "zhvi_state.csv",
        "zori_metro.csv",
        "zhvi_zip.csv",
        "zori_zip.csv",
        *(f"zhvi_zip_b{b}.csv" for b in range(1, 6)),
    }
    assert any(
        u.endswith("zhvi/Zip_zhvi_bdrmcnt_3_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv")
        for u in urls
    )
    assert all(u.startswith("https://files.zillowstatic.com/research/public_csvs/") for u in urls)
    assert any(u.endswith("zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv") for u in urls)


def test_zip_parts_start_in_2019_and_carry_the_zip_code() -> None:
    out = _out()
    reg = {r["vendor_region_id"]: r for r in out.regions.to_dicts()}
    assert reg["92617"] == {
        "vendor_region_id": "92617",
        "vendor_name": "78704",
        "level": "ZIP",
        "code": "78704",
    }
    zhvi = out.obs.filter(series_id="zillow.zhvi.all.mid.sa", vendor_region_id="92617")
    assert zhvi["period_start"].min() == date(2019, 1, 1)  # fixture starts 2018-01
    assert zhvi.filter(period_start=date(2026, 9, 1))["period_end"].to_list() == [date(2026, 9, 30)]


def test_bedroom_series_only_from_their_file() -> None:
    obs = _out().obs
    b5 = obs.filter(series_id="zillow.zhvi.b5.mid.sa")
    assert set(b5["vendor_region_id"]) == {"61148", "92617"}  # 08701, 78704
    assert b5.filter(vendor_region_id="92614").height == 0  # 78701 has no 5-bed file row
