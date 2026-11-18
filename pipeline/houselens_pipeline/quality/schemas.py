"""Pandera schema for the canonical observation frame."""

import pandera.polars as pa
import polars as pl

OBS_SCHEMA = pa.DataFrameSchema(
    {
        "series_id": pa.Column(pl.String, nullable=False),
        "geo_id": pa.Column(pl.String, pa.Check.str_matches(r"^(US|ST:\d{2}|CBSA:\d{5})$")),
        "period_start": pa.Column(pl.Date, nullable=False),
        "period_end": pa.Column(pl.Date, nullable=False),
        "value": pa.Column(
            pl.Float64,
            # is_finite() is null for null, so nullable=False handles nulls separately
            pa.Check(lambda data: data.lazyframe.select(pl.col(data.key).is_finite())),
            nullable=False,
        ),
        "release_date": pa.Column(pl.Date, nullable=True),
        "quality_flags": pa.Column(pl.List(pl.String), nullable=False),
    },
    checks=pa.Check(
        lambda data: data.lazyframe.select(pl.col("period_end") >= pl.col("period_start")),
        error="period_end must be >= period_start",
    ),
    strict=True,
)


def validate_obs(df: pl.DataFrame) -> pl.DataFrame:
    """Validate a canonical observation frame.

    Args:
        df: Frame with the canonical observation columns.

    Returns:
        The validated frame.

    Raises:
        pandera.errors.SchemaError: If any constraint is violated.
    """
    return OBS_SCHEMA.validate(df)
