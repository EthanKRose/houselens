.PHONY: test-py lint-py

test-py:
	cd pipeline && uv run pytest

lint-py:
	cd pipeline && uv run ruff format --check . && uv run ruff check . && uv run mypy
