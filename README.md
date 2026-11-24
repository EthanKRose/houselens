# HouseLens

HouseLens is a static, source-transparent tracker of U.S. housing data. It pulls free,
license-compatible series (FRED, FHFA, Zillow Research, Realtor.com Research), keeps every
release as a dated vintage, and publishes a static site where every number shows its source,
method, seasonal adjustment, release date and vintage date. Sources and their terms are listed in
[LICENSES.md](LICENSES.md); how each source is used is in [docs/sources/](docs/sources/).

**Analyze a property:** https://houselens-us.vercel.app/property compares a home you found (typed or pasted from a listing) with free ZIP-level figures and judges it as a home, a rental or a flip.

**Live site:** https://houselens-us.vercel.app (the original `houselens-five.vercel.app` permanently redirects there).

## Data flow

```
GitHub Actions (daily cron)
  1. restore houselens.duckdb (persisted state, all vintages)
  2. adapters/  fetch each source → temp raw file (checksum recorded in ingest_run)
  3. normalize/ → canonical rows (Pandera-validated)
  4. append new vintages to DuckDB (skip if the raw files, catalog.yaml and known_events.yaml are all unchanged)
  5. export/    DuckDB → web/public/data/*.json
  6. next build (static export) → deploy to Vercel
  7. persist houselens.duckdb
```

## Layout

- `pipeline/`: Python 3.12 pipeline (uv, Polars, DuckDB, Pandera). See [pipeline/README.md](pipeline/README.md).
- `web/`: Next.js 15 static site (`output: "export"`), built to `web/out`.
- `docs/`: spec, plans and per-source notes.

## Make targets

| Target | What it runs |
|---|---|
| `make test-py` | pytest in `pipeline/` |
| `make lint-py` | ruff format --check, ruff check (incl. docstring rules), mypy --strict |
| `make ingest` | real ingest into `data/houselens.duckdb` (needs `FRED_API_KEY`; fetches Zillow, FHFA and Realtor.com files) |
| `make ingest-fixtures` | ingest the checked-in fixtures into `data/fixture.duckdb` (no network) |
| `make site-data-fixtures` | `ingest-fixtures`, then export the fixture DB to `web/public/data/` (gitignored) for local web work |

All run through `uv` from `pipeline/`. Web checks run from `web/`: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, `npm run test:e2e`.

## Operating

The nightly workflow (`.github/workflows/ingest.yml`, 12:00 UTC plus manual `workflow_dispatch`) restores the DuckDB file from a private R2 bucket, ingests, exports, builds, deploys to Vercel and writes the DB back (previous copy kept as `houselens.prev.duckdb`). A failed source still deploys last-good data and persists new vintages, but marks the run failed. If the R2 download fails, or the object is missing without `first_run`, the run stops before ingest. Editing `catalog.yaml` or `known_events.yaml` takes effect on the next run; a parser code change alone is not fingerprinted, so it applies when the vendor next publishes a new file (or when either YAML changes).

**Required repository secrets:** `FRED_API_KEY`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

**First run (owner steps):**

1. Create a FRED API key.
2. Create a private Cloudflare R2 bucket and an access token scoped to that bucket only.
3. Create a Vercel project and token; note the org and project IDs. The project must use framework preset "Other" with no build command (static directory deploy of `web/out`); verify this on the first run.
4. Add the secrets above, push the repo to GitHub, then trigger the workflow with `workflow_dispatch`. Dispatch with `first_run=true`: only then may the workflow create a fresh DB when R2 has none. Scheduled runs and normal dispatches fail instead, so history is never replaced by an empty DB.
5. After the first deploy, hard-load a share link such as `/compare?geo=CBSA:12420` (paste it into a fresh tab, not a client-side navigation). The static export writes `compare.html`; `web/public/vercel.json` (`cleanUrls`) is what lets Vercel serve it at `/compare`. If it 404s, fix the Vercel project settings before announcing.

**Redfin (manual drop):** HouseLens never fetches redfin.com. The Redfin source is disabled until written permission exists; afterwards, place the file under `inputs/redfin/` in the R2 bucket and the workflow syncs only that prefix into `data/inputs/redfin/`.

**Status:** live since the first run on 2026-11-19 (R2, Vercel and FRED all verified, deep links included). The site is served at https://houselens-us.vercel.app; that address and the `houselens-five.vercel.app` redirect are set under the Vercel project's Settings → Domains. Only the ingest workflow deploys: the root `vercel.json` turns off Vercel's Git auto-deploys, which would publish the repo root (no site there) on every push and take the site down with a 404.
