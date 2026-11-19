# HouseLens pipeline

Python pipeline that fetches free, license-compatible U.S. housing series,
normalizes them into the canonical schema, validates them and appends new
vintages to DuckDB. Source notes live in `docs/sources/`; licensing in
`LICENSES.md`.

## Setup

```bash
cd pipeline
uv sync            # Python 3.12, pinned in .python-version
```

## Checks

```bash
uv run pytest                  # tests
uv run ruff format --check .   # formatting
uv run ruff check .            # lint + docstring (D) rules, google convention
uv run mypy                    # strict typing
```

Or from the repo root: `make test-py` and `make lint-py`.

## Usage

```bash
# ingest every enabled source (one source failing never stops the others)
FRED_API_KEY=... uv run houselens ingest --db ../data/houselens.duckdb --report-dir ../data/reports

# offline: read raw files from <input-dir>/<source_id>/ instead of fetching
uv run houselens ingest --db ../data/fixture.duckdb --input-dir tests/fixtures \
    --sources fhfa,zillow --max-unmatched-share 0.2

# write the static site JSON from a database
uv run houselens export --db ../data/houselens.duckdb --out ../web/public/data
```

`ingest` flags:

- `--db`: DuckDB file (required; created if missing).
- `--sources`: comma-separated source ids (default: every enabled source).
- `--run-date`: vintage date, `YYYY-MM-DD` (default: today).
- `--input-dir`: use `<input-dir>/<source_id>/` raw drops instead of fetching. Redfin is manual-drop only and fails without one.
- `--report-dir`: where `unmatched_<source_id>.json` reports go (default `reports`).
- `--max-unmatched-share`: fail a source when more than this share of its regions cannot be mapped to a geography (default `0.05`).

`FRED_API_KEY` (environment) is required for FRED unless `--input-dir/fred/` exists.

Exit codes: `0` all sources ok, `1` at least one source failed (others still written), `2` crash.
The nightly workflow persists the database on 0 and 1 but never on 2.

## Layout

- `houselens_pipeline/cli.py`: `ingest` / `export` entry point and per-source failure isolation.
- `houselens_pipeline/adapters/`: one adapter per source (`fred`, `fhfa`, `zillow`, `realtor`) on the `base.py` interface: fetch raw parts, parse to canonical observations.
- `houselens_pipeline/catalog.py` + `catalog.yaml`: sources, metrics, series, methodology text, known events.
- `houselens_pipeline/geo/`: canonical geographies, vendor-region resolution and `vendor_overrides.yaml`.
- `houselens_pipeline/normalize/`, `quality/`: period handling, Pandera schemas and known-event flags.
- `houselens_pipeline/ingest.py`, `db.py`, `schema.sql`: append-only vintages in DuckDB.
- `houselens_pipeline/export.py`: static JSON for the web app.
- `tests/` pytest and hypothesis tests (docstring rules are not enforced here)
