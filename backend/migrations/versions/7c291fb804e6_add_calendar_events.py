"""Add user-owned calendar events."""

import sqlalchemy as sa
from alembic import op

revision = "7c291fb804e6"
down_revision = "0e7ef57141b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calendar_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("source", sa.String(30), nullable=False),
        sa.Column("external_uid", sa.String(1024), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("location", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("starts_at", sa.Integer(), nullable=False),
        sa.Column("ends_at", sa.Integer(), nullable=False),
        sa.Column("imported_at", sa.Integer(), nullable=False),
        sa.UniqueConstraint("user_id", "source", "external_uid"),
    )
    op.create_index("ix_calendar_events_user_id", "calendar_events", ["user_id"])
    op.create_index("ix_calendar_events_starts_at", "calendar_events", ["starts_at"])


def downgrade() -> None:
    op.drop_table("calendar_events")
