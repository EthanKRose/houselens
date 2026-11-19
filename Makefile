.PHONY: test-py lint-py ingest-fixtures ingest

test-py:
	cd pipeline && uv run pytest

lint-py:
	cd pipeline && uv run ruff format --check . && uv run ruff check . && uv run mypy

ingest-fixtures:
	mkdir -p data && cd pipeline && uv run houselens ingest --db ../data/fixture.duckdb \
		--input-dir tests/fixtures --report-dir ../data/reports

ingest:
	mkdir -p data && cd pipeline && uv run houselens ingest --db ../data/houselens.duckdb \
		--report-dir ../data/reports
