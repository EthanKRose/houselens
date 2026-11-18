# HouseLens

HouseLens is a static, source-transparent tracker of U.S. housing data. It pulls free,
license-compatible series (FRED, FHFA, Zillow Research, Realtor.com Research), keeps every
release as a dated vintage, and publishes a static site where every number shows its source,
method, seasonal adjustment, release date and vintage date. Sources and their terms are listed in
[LICENSES.md](LICENSES.md); the design is in [docs/spec.md](docs/spec.md).

## Data flow

```
GitHub Actions (daily cron)
  1. restore houselens.duckdb (persisted state, all vintages)
  2. adapters/  fetch each source → temp raw file (checksum recorded in ingest_run)
  3. normalize/ → canonical rows (Pandera-validated)
  4. append new vintages to DuckDB (skip if checksum unchanged)
  5. export/    DuckDB → web/public/data/*.json
  6. next build (static export) → deploy to Vercel
  7. persist houselens.duckdb
```

## Layout

- `pipeline/`: Python 3.12 pipeline (uv, Polars, DuckDB, Pandera). See [pipeline/README.md](pipeline/README.md).
- `web/`: Next.js static site (added in a later task).
- `docs/`: spec, plans and per-source notes.

## Make targets

| Target | What it runs |
|---|---|
| `make test-py` | pytest in `pipeline/` |
| `make lint-py` | ruff format --check, ruff check (incl. docstring rules), mypy --strict |

Both run through `uv` from `pipeline/`.
