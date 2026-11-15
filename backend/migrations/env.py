from alembic import context
from app.core.config import Settings
from app.core.database import create_database
from app.models import Base

target_metadata = Base.metadata

if context.is_offline_mode():
    context.configure(
        url=f"sqlite:///{Settings().database_path}",
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    engine, _ = create_database(Settings())
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata, render_as_batch=True
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()
