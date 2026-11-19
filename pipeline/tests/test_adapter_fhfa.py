from datetime import date
from pathlib import Path

import httpx

from houselens_pipeline.adapters.base import AdapterOutput, read_parts
from houselens_pipeline.adapters.fhfa import FhfaAdapter
from houselens_pipeline.catalog import load_catalog

FIX = Path(__file__).parent / "fixtures" / "fhfa"


def _out() -> AdapterOutput:
    return FhfaAdapter().parse(read_parts(FIX), load_catalog())


def test_us_monthly_sa_only_usa() -> None:
    out = _out()
    obs = out.obs.filter(series_id="fhfa.hpi.po.m.sa")
    assert obs["vendor_region_id"].unique().to_list() == ["USA"]
    assert obs.height == 6
    last = obs.sort("period_start").row(-1, named=True)
    assert (last["period_start"], last["period_end"], last["value"]) == (
        date(2026, 8, 1),
        date(2026, 8, 31),
        444.61,
    )
    assert last["release_date"] is None
    assert out.regions.filter(level="US").to_dicts() == [
        {"vendor_region_id": "USA", "vendor_name": "United States", "level": "US", "code": None}
    ]


def test_state_quarterly() -> None:
    obs = _out().obs.filter(series_id="fhfa.hpi.po.q.sa", vendor_region_id="TX")
    row = obs.filter(period_start=date(2026, 4, 1))
    assert row["period_end"].to_list() == [date(2026, 6, 30)]
    assert row["value"].to_list() == [444.25]


def test_msa_code_passed() -> None:
    out = _out()
    obs = out.obs.filter(series_id="fhfa.hpi.at.q.nsa", vendor_region_id="12420")
    assert obs.height == 6 and obs["value"][0] == 506.40
    reg = out.regions.filter(vendor_region_id="12420")
    assert reg.to_dicts() == [
        {
            "vendor_region_id": "12420",
            "vendor_name": "Austin-Round Rock-San Marcos, TX",
            "level": "CBSA",
            "code": "12420",
        }
    ]
    assert out.regions.filter(vendor_region_id="TX")["level"].to_list() == ["ST"]


def test_msad_row_present_with_code() -> None:
    out = _out()
    assert out.obs.filter(vendor_region_id="14454").height == 3
    assert out.regions.filter(vendor_region_id="14454")["code"].to_list() == ["14454"]


def test_blank_skipped_and_divisions_and_other_flavors_dropped() -> None:
    out = _out()
    tx = out.obs.filter(series_id="fhfa.hpi.po.q.sa")
    assert date(2025, 1, 1) not in tx["period_start"].to_list() and tx.height == 5
    assert "DV_ENC" not in out.regions["vendor_region_id"].to_list()
    assert out.obs["series_id"].n_unique() == 3  # all-transactions State row ignored
    assert "quality_flags" not in out.obs.columns


def test_fetch_gets_master_csv() -> None:
    urls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        urls.append(str(req.url))
        return httpx.Response(200, content=b"x")

    parts = FhfaAdapter(client=httpx.Client(transport=httpx.MockTransport(handler))).fetch()
    assert urls == ["https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv"]
    assert parts == {"hpi_master.csv": b"x"}
