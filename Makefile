.PHONY: site-data-fixtures test-py lint-py ingest-fixtures ingest

test-py:
	cd pipeline && uv run pytest

lint-py:
	cd pipeline && uv run ruff format --check . && uv run ruff check . && uv run mypy

ingest-fixtures:
	mkdir -p data && cd pipeline && uv run houselens ingest --db ../data/fixture.duckdb \
		--input-dir tests/fixtures --report-dir ../data/reports --max-unmatched-share 0.2

ingest:
	mkdir -p data && cd pipeline && uv run houselens ingest --db ../data/houselens.duckdb \
		--report-dir ../data/reports

site-data-fixtures: ingest-fixtures
	mkdir -p web/public/data && cd pipeline && uv run houselens export --db ../data/fixture.duckdb \
		--out ../web/public/data
