"""Adapter protocol and shared helpers."""

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import polars as pl

from houselens_pipeline.catalog import Catalog


@dataclass
class AdapterOutput:
    """Parsed adapter result.

    Attributes:
        obs: Observations with ``vendor_region_id`` instead of ``geo_id``.
        regions: Columns ``vendor_region_id, vendor_name, level, code`` for geo resolution.
    """

    obs: pl.DataFrame
    regions: pl.DataFrame


class Adapter(Protocol):
    """A data source: fetch raw parts, then parse them."""

    source_id: str

    def fetch(self) -> dict[str, bytes]:
        """Download raw parts, keyed by file name."""
        ...

    def parse(self, parts: dict[str, bytes], catalog: Catalog) -> AdapterOutput:
        """Turn raw parts into observations and regions."""
        ...


def read_parts(dir: Path) -> dict[str, bytes]:  # noqa: A002
    """Read every file in a directory.

    Args:
        dir: Directory of raw files.

    Returns:
        File name to bytes.
    """
    return {p.name: p.read_bytes() for p in sorted(dir.iterdir()) if p.is_file()}


def checksum(parts: dict[str, bytes]) -> str:
    """Hash parts over sorted names and bytes.

    Args:
        parts: File name to bytes.

    Returns:
        Hex sha256 digest.
    """
    h = hashlib.sha256()
    for name in sorted(parts):
        h.update(name.encode())
        h.update(parts[name])
    return h.hexdigest()
