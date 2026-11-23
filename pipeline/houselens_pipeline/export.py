"""Export the latest vintage of every series to small static JSON files for the site."""

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

import duckdb

from houselens_pipeline.catalog import Catalog
from houselens_pipeline.geo.reference import msad_cbsa_codes, zip_parents
from houselens_pipeline.quality.known_events import load_known_events

_HIDDEN_SERIES_FIELDS = ("vendor_key", "fixed_geo_id")


def _write(path: Path, obj: object) -> None:
    path.write_text(json.dumps(obj, allow_nan=False, separators=(",", ":")), encoding="utf-8")


def export_site_data(con: duckdb.DuckDBPyConnection, out_dir: Path, catalog: Catalog) -> None:
    """Write the site JSON: catalog, geographies, freshness, ``geo/*.json`` and ``zip/*.json``.

    Only enabled sources' series that have data are exported, from the latest vintage. ZIP codes
    stay out of ``geographies.json`` and ``geo/``; they go to ``zip/<first 3 digits>.json``
    shards with the latest value and the values 1 and 5 years earlier. Stale ``geo/*.json`` and
    ``zip/*.json`` files are removed; nothing else in ``out_dir`` is touched.

    Args:
        con: Connection to a populated database.
        out_dir: Output directory (created if missing).
        catalog: Catalog supplying the catalog-only fields.
    """
    geo_dir = out_dir / "geo"
    geo_dir.mkdir(parents=True, exist_ok=True)
    enabled = {s.source_id for s in catalog.sources if s.enabled}

    geos_by_series: dict[str, list[str]] = {}
    for sid, gid in con.execute(
        "select distinct series_id, geo_id from observation_latest where value is not null"
        " order by 1, 2"
    ).fetchall():
        geos_by_series.setdefault(sid, []).append(gid)
    series = [s for s in catalog.series if s.source_id in enabled and s.series_id in geos_by_series]
    sources = [
        s for s in catalog.sources if s.enabled and any(x.source_id == s.source_id for x in series)
    ]
    metric_ids = {s.metric_id for s in series}

    _write(
        out_dir / "catalog.json",
        {
            "sources": [
                {k: v for k, v in asdict(s).items() if k not in ("access_method", "enabled")}
                for s in sources
            ],
            "metrics": [asdict(m) for m in catalog.metrics if m.metric_id in metric_ids],
            "series": [
                {
                    **{k: v for k, v in asdict(s).items() if k not in _HIDDEN_SERIES_FIELDS},
                    "national_only": geos_by_series[s.series_id] == ["US"],
                    "levels": sorted({g.split(":")[0] for g in geos_by_series[s.series_id]}),
                }
                for s in series
            ],
            "known_events": load_known_events(),
        },
    )

    ids_by_geo: dict[str, list[str]] = {}
    for s in series:
        for g in geos_by_series[s.series_id]:
            if not g.startswith("ZIP:"):
                ids_by_geo.setdefault(g, []).append(s.series_id)
    msad = msad_cbsa_codes()
    geos = con.execute(
        "select geo_id, level, name, state_fips, non_disclosure from geography"
        " where level <> 'ZIP' order by geo_id"
    ).fetchall()
    _write(
        out_dir / "geographies.json",
        [
            {
                "geo_id": g, "level": lv, "name": nm, "state_fips": st,
                "non_disclosure": nd,
                "has_msad": lv == "CBSA" and g.removeprefix("CBSA:") in msad,
                "series_ids": ids_by_geo[g],
            }
            for g, lv, nm, st, nd in geos
            if g in ids_by_geo
        ],
    )  # fmt: skip

    fresh = con.execute(
        "select series_id, max(period_end), max(release_date) from observation_latest"
        " where value is not null group by 1"
    ).fetchall()
    ingested = dict(
        con.execute(
            "select source_id, max(finished_at) from ingest_run"
            " where status in ('ok','unchanged') group by 1"
        ).fetchall()
    )
    by_id = {s.series_id: s for s in series}
    _write(
        out_dir / "freshness.json",
        {
            sid: {
                "last_period_end": end.isoformat(),
                "last_release_date": rel.isoformat() if rel else None,
                "last_ingest_at": ing.isoformat()
                if (ing := ingested.get(by_id[sid].source_id))
                else None,
                "frequency": by_id[sid].frequency,
                "typical_lag_days": by_id[sid].typical_lag_days,
            }
            for sid, end, rel in fresh
            if sid in by_id
        },
    )

    files: dict[str, dict[str, Any]] = {}
    rows = con.execute(
        "select geo_id, series_id, period_start, period_end, value, vintage_date, release_date,"
        " coalesce(quality_flags, []) from observation_latest where value is not null"
        " and geo_id not like 'ZIP:%' order by geo_id, series_id, period_start"
    ).fetchall()
    for gid, sid, ps, pe, val, vint, rel, flags in rows:
        if sid not in by_id:
            continue
        entry = files.setdefault(gid, {"geo_id": gid, "series": {}})["series"].setdefault(
            sid, {"points": []}
        )
        entry["vintage_date"] = vint.isoformat()  # rows ascend, so the last write is the latest
        entry["release_date"] = rel.isoformat() if rel else None
        entry["points"].append([ps.isoformat(), pe.isoformat(), val, list(flags)])
    keep = {g.replace(":", "_") + ".json" for g in files}
    for stale in geo_dir.glob("*.json"):
        if stale.name not in keep:
            stale.unlink()
    for gid, obj in files.items():
        _write(geo_dir / (gid.replace(":", "_") + ".json"), obj)
    _export_zip_shards(con, out_dir / "zip", by_id)


# Latest point per (series, ZIP) plus the same month 1 and 5 years earlier.
_ZIP_POINTS = """
with l as (select * from observation_latest where geo_id like 'ZIP:%' and value is not null),
last as (select series_id, geo_id, max(period_start) ps from l group by 1, 2)
select substr(l.geo_id, 5), l.series_id, l.period_start, l.period_end, l.value, l.vintage_date,
       l.release_date, coalesce(l.quality_flags, []), y1.value, y5.value
from last
join l on l.series_id = last.series_id and l.geo_id = last.geo_id and l.period_start = last.ps
left join l y1 on y1.series_id = last.series_id and y1.geo_id = last.geo_id
  and y1.period_start = last.ps - interval 1 year
left join l y5 on y5.series_id = last.series_id and y5.geo_id = last.geo_id
  and y5.period_start = last.ps - interval 5 year
order by 1, 2
"""


def _export_zip_shards(
    con: duckdb.DuckDBPyConnection, zip_dir: Path, by_id: dict[str, Any]
) -> None:
    zip_dir.mkdir(parents=True, exist_ok=True)
    names = dict(
        con.execute(
            "select geo_id, name || '|' || non_disclosure from geography where level = 'ZIP'"
        ).fetchall()
    )
    parents = zip_parents()
    shards: dict[str, dict[str, Any]] = {}
    for z, sid, ps, pe, val, vint, rel, flags, y1, y5 in con.execute(_ZIP_POINTS).fetchall():
        if sid not in by_id:
            continue
        if z not in (shard := shards.setdefault(z[:3], {})):
            name, nd = names[f"ZIP:{z}"].rsplit("|", 1)
            county, cbsa = parents.get(z, (None, None))
            shard[z] = {
                "name": name, "county": county, "cbsa": cbsa,
                "non_disclosure": nd == "true", "series": {},
            }  # fmt: skip
        shard[z]["series"][sid] = {
            "start": ps.isoformat(), "end": pe.isoformat(), "value": val, "y1": y1, "y5": y5,
            "vintage_date": vint.isoformat(),
            "release_date": rel.isoformat() if rel else None, "flags": list(flags),
        }  # fmt: skip
    for stale in zip_dir.glob("*.json"):
        if stale.stem not in shards:
            stale.unlink()
    for prefix, obj in shards.items():
        _write(zip_dir / f"{prefix}.json", obj)
