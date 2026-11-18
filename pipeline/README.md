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

## Layout

- `houselens_pipeline/` package (adapters, normalize, export land here as they are built)
- `tests/` pytest and hypothesis tests (docstring rules are not enforced here)
