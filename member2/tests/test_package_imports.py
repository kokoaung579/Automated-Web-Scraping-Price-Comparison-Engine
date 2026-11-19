import os
import subprocess
import sys
from pathlib import Path


def test_member2_repository_imports_from_backend_launch_directory():
    repository_root = Path(__file__).resolve().parents[2]
    backend_directory = repository_root / "Backend"
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(repository_root)
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    script = """
from pathlib import Path

import app.config
import member2.app.job_repository as job_repository

assert Path(app.config.__file__).resolve().parents[1] == Path.cwd().resolve()
assert job_repository.__name__ == "member2.app.job_repository"
"""
    result = subprocess.run(
        [sys.executable, "-B", "-c", script],
        cwd=backend_directory,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_member2_router_imports_from_repository_root_without_generic_app():
    repository_root = Path(__file__).resolve().parents[2]
    script = """
import importlib
import sys
import types

host_app = types.ModuleType("app")
host_app.__path__ = []
sys.modules["app"] = host_app

module_names = (
    "member2.app.routers.jobs",
    "member2.app.job_repository",
    "member2.app.job_service",
    "member2.app.job_worker",
    "member2.app.scraper_registry",
    "member2.app.product_normalizer",
    "member2.app.scrapers.books_scraper",
    "member2.app.scrapers.dummyjson_scraper",
    "member2.app.scrapers.fakestore_scraper",
    "member2.app.scrapers.quotes_playwright_scraper",
)
for module_name in module_names:
    imported = importlib.import_module(module_name)
    assert imported.__name__ == module_name

assert sys.modules["app"] is host_app
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=repository_root,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
