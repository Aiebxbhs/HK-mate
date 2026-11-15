from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from app.core.config import ROOT, Settings
from app.main import create_app
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("HKM_AUTO_MAIL_ENABLED", "false")
    database = tmp_path / "test.sqlite3"
    monkeypatch.setenv("HKM_DATABASE_PATH", str(database))
    command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
    app = create_app(Settings(database_path=database, allowed_origins=("http://testserver",)))
    with TestClient(app) as connection:
        yield connection
