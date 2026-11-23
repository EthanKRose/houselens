from datetime import date
from pathlib import Path

import httpx
import polars as pl

from houselens_pipeline.adapters.base import AdapterOutput, read_parts
from houselens_pipeline.adapters.realtor import RealtorAdapter
from houselens_pipeline.catalog import load_catalog

FIX = Path(__file__).parent / "fixtures" / "realtor"
PRICE = "realtor.median_list_price.all.nsa"


def _out() -> AdapterOutput:
    return RealtorAdapter().parse(read_parts(FIX), load_catalog())


def test_month_period() -> None:
    obs = _out().obs.filter(series_id=PRICE, vendor_region_id="US")
    row = obs.filter(period_start=date(2026, 10, 1))
    assert row["period_end"].to_list() == [date(2026, 10, 31)]
    assert row["value"].to_list() == [415000.0]
    assert obs.height == 14


def test_cbsa_code_passed() -> None:
    reg = _out().regions
    assert reg.filter(level="CBSA").sort("code").select("vendor_region_id", "code").rows() == [
        ("12420", "12420"),
        ("25100", "25100"),
        ("35620", "35620"),
    ]
    assert reg.filter(level="US")["code"].to_list() == [None]
    assert reg.filter(level="ST").select("vendor_region_id", "vendor_name").rows() == [
        ("TX", "Texas")
    ]


def test_only_catalog_columns() -> None:
    obs = _out().obs
    assert set(obs["series_id"]) == {
        "realtor.median_list_price.all.nsa",
        "realtor.active_listings.all.nsa",
        "realtor.dom.all.nsa",
        "realtor.price_reduced_share.all.nsa",
        "realtor.median_list_ppsf.all.nsa",
    }
    # US Oct 2026 median_listing_price_yy is -0.0221; no such value may appear.
    assert -0.0221 not in obs["value"].to_list()
    assert obs.filter(series_id=PRICE)["value"].min() > 1000  # type: ignore[operator]


def test_quality_flag_mapped() -> None:
    obs = _out().obs.filter(vendor_region_id="12420")
    assert obs["quality_flags"].dtype == pl.List(pl.String)
    flagged = obs.filter(pl.col("quality_flags").list.len() > 0)
    assert flagged["period_start"].unique().to_list() == [date(2026, 10, 1)]
    assert flagged["quality_flags"].list.first().unique().to_list() == ["realtor_quality_flag"]
    assert _out().obs["quality_flags"].null_count() == 0


def test_blank_skipped() -> None:
    obs = _out().obs.filter(vendor_region_id="25100")
    assert obs["series_id"].to_list().count("realtor.dom.all.nsa") == 0
    assert obs.height == 4 and obs["value"].null_count() == 0
    assert obs["period_start"].unique().to_list() == [date(2017, 2, 1)]


def test_fetch_urls() -> None:
    urls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        urls.append(str(req.url))
        return httpx.Response(200, content=b"x")

    parts = RealtorAdapter(httpx.Client(transport=httpx.MockTransport(handler))).fetch()
    assert set(parts) == {"country.csv", "state.csv", "metro.csv", "zip.csv"}
    base = "https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_"
    assert sorted(urls) == [
        *(f"{base}{n}_History.csv" for n in ("Country", "Metro", "State")),
        f"{base}Zip.csv",  # latest month only: the ZIP history file is ~840 MB
    ]


def test_price_reduced_share_is_a_percent() -> None:
    # The file stores a 0-1 fraction (Austin 2026-10: 4,444 of 11,631 listings, 0.2625).
    obs = _out().obs.filter(series_id="realtor.price_reduced_share.all.nsa")
    austin = obs.filter(vendor_region_id="12420", period_start=date(2026, 10, 1))
    assert austin["value"].to_list() == [26.25]


def test_zip_rows() -> None:
    out = _out()
    reg = {r["vendor_region_id"]: r for r in out.regions.to_dicts()}
    assert reg["zip:78704"] == {
        "vendor_region_id": "zip:78704",
        "vendor_name": "austin, tx",
        "level": "ZIP",
        "code": "78704",
    }
    z = out.obs.filter(vendor_region_id="zip:78704", period_start=date(2026, 10, 1))
    by = dict(zip(z["series_id"], z["value"], strict=True))
    assert by["realtor.median_list_ppsf.all.nsa"] == 512.0
    assert by[PRICE] == 725000.0
    assert by["realtor.price_reduced_share.all.nsa"] == 23.32


def test_zip_ids_never_collide_with_metro_codes() -> None:
    # ZIP 12420 (Cragsmoor, NY) shares its number with CBSA 12420 (Austin).
    reg = {r["vendor_region_id"]: r for r in _out().regions.to_dicts()}
    assert reg["12420"]["level"] == "CBSA"
    assert reg["zip:12420"] == {
        "vendor_region_id": "zip:12420",
        "vendor_name": None,
        "level": "ZIP",
        "code": "12420",
    }
