"""Add mail categories: one label per mail, no content stored."""

import sqlalchemy as sa
from alembic import op

revision = "e8b4c2d7f6a1"
down_revision = "d5e3f7a1b2c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mail_categories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "connection_id",
            sa.String(36),
            sa.ForeignKey("email_connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("message_id", sa.String(128), nullable=False),
        sa.Column("category", sa.String(20), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("queued_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.UniqueConstraint("connection_id", "message_id"),
    )
    op.create_index("ix_mail_categories_user_id", "mail_categories", ["user_id"])
    op.create_index("ix_mail_categories_connection_id", "mail_categories", ["connection_id"])
    op.create_index("ix_mail_categories_status", "mail_categories", ["status"])
    op.create_index("ix_mail_categories_queued_at", "mail_categories", ["queued_at"])


def downgrade() -> None:
    op.drop_table("mail_categories")
