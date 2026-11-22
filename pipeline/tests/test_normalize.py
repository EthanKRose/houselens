from datetime import date, timedelta

import pandera.errors
import polars as pl
import pytest
from hypothesis import given
from hypothesis import strategies as st

from houselens_pipeline.normalize.periods import month, quarter, week_ending
from houselens_pipeline.quality.known_events import apply_known_events, load_known_events
from houselens_pipeline.quality.schemas import validate_obs

DAY = timedelta(days=1)


@given(st.dates(min_value=date(1900, 1, 1), max_value=date(2100, 12, 31)))
def test_month_contains_and_chains(d: date) -> None:
    start, end = month(d)
    assert start <= d <= end
    nxt = end + DAY
    assert month(nxt)[0] == nxt


def test_quarter_and_week() -> None:
    assert quarter(2026, 3) == (date(2026, 7, 1), date(2026, 9, 30))
    assert week_ending(date(2026, 1, 10)) == (date(2026, 1, 4), date(2026, 1, 10))


def _obs(**over: object) -> pl.DataFrame:
    row: dict[str, object] = {
        "series_id": "s",
        "geo_id": "US",
        "period_start": date(2025, 9, 1),
        "period_end": date(2025, 9, 30),
        "value": 1.0,
        "release_date": None,
        "quality_flags": [],
    }
    row.update(over)
    return pl.DataFrame(
        [row],
        schema={
            "series_id": pl.String,
            "geo_id": pl.String,
            "period_start": pl.Date,
            "period_end": pl.Date,
            "value": pl.Float64,
            "release_date": pl.Date,
            "quality_flags": pl.List(pl.String),
        },
    )


def test_validate_ok() -> None:
    assert validate_obs(_obs()).height == 1
    assert validate_obs(_obs(geo_id="CBSA:12420")).height == 1
    assert validate_obs(_obs(geo_id="ZIP:78701")).height == 1


@pytest.mark.parametrize(
    "bad",
    [
        {"value": float("nan")},
        {"value": float("inf")},
        {"value": None},
        {"period_end": date(2025, 8, 1)},
        {"geo_id": "ZIP:7870"},  # ZIPs are 5 digits
    ],
)
def test_validate_rejects(bad: dict[str, object]) -> None:
    with pytest.raises((pandera.errors.SchemaError, pandera.errors.SchemaErrors)):
        validate_obs(_obs(**bad))


def test_known_events() -> None:
    sep = apply_known_events(_obs(series_id="fred.cpi.rent.sa"))
    assert sep["quality_flags"].to_list() == [[]]
    octo = apply_known_events(
        _obs(
            series_id="fred.cpi.oer.sa",
            period_start=date(2025, 10, 1),
            period_end=date(2025, 10, 31),
            quality_flags=["x", "cpi_carry_forward_2025_10"],
        )
    )
    assert octo["quality_flags"].to_list() == [["x", "cpi_carry_forward_2025_10"]]
    no_col = apply_known_events(
        _obs(series_id="fred.cpi.rent.sa", period_start=date(2025, 10, 1)).drop("quality_flags")
    )
    assert no_col["quality_flags"].to_list() == [["cpi_carry_forward_2025_10"]]


def test_load_known_events() -> None:
    ev = load_known_events()
    assert "Rents for October 2025 were carried forward" in ev["cpi_carry_forward_2025_10"]
    assert "cpi_collection_suspended" in ev
