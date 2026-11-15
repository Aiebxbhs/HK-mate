"""Add event kind (event/deadline) and completion time to calendar events."""

import sqlalchemy as sa
from alembic import op

revision = "b3f1c9d2a7e5"
down_revision = "88a91fa2ab30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Additive only: existing rows become ordinary, not-completed events.
    with op.batch_alter_table("calendar_events") as batch:
        batch.add_column(sa.Column("kind", sa.String(20), nullable=False, server_default="event"))
        batch.add_column(sa.Column("completed_at", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("calendar_events") as batch:
        batch.drop_column("completed_at")
        batch.drop_column("kind")
