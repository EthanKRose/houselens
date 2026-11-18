"""Smoke test: the pipeline package imports and reports its version."""

import houselens_pipeline


def test_package_imports() -> None:
    assert houselens_pipeline.__version__ == "0.1.0"
