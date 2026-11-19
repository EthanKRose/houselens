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

## Operating

The nightly workflow (`.github/workflows/ingest.yml`, 12:00 UTC plus manual `workflow_dispatch`) restores the DuckDB file from a private R2 bucket, ingests, exports, builds, deploys to Vercel and writes the DB back (previous copy kept as `houselens.prev.duckdb`). A failed source still deploys last-good data and persists new vintages, but marks the run failed. If the R2 download fails for any reason other than "no such object", the run stops before ingest.

**Required repository secrets:** `FRED_API_KEY`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

**First run (owner steps):**

1. Create a FRED API key.
2. Create a private Cloudflare R2 bucket and an access token scoped to that bucket only.
3. Create a Vercel project and token; note the org and project IDs.
4. Add the secrets above, push the repo to GitHub, then trigger the workflow with `workflow_dispatch`. With no remote DB the first run creates a fresh one.

**Redfin (manual drop):** HouseLens never fetches redfin.com. The Redfin source is disabled until written permission exists; afterwards, place the file under `inputs/redfin/` in the R2 bucket and the workflow syncs only that prefix into `data/inputs/redfin/`.

**Status:** the first real run is PENDING. Nothing has been executed against R2, Vercel or FRED yet; only local lint (actionlint, shellcheck) has passed.
