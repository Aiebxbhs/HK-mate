from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings


def create_database(settings: Settings) -> tuple[Engine, sessionmaker[Session]]:
    settings.database_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    engine = create_engine(
        f"sqlite:///{settings.database_path}",
        connect_args={"check_same_thread": False, "timeout": 5},
        hide_parameters=True,
    )

    @event.listens_for(engine, "connect")
    def _configure_sqlite(connection, _):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    return engine, sessionmaker(engine, expire_on_commit=False)
