"""Persist encrypted automatic-mail notifications and detection cursors."""

import sqlalchemy as sa
from alembic import op

revision = "88a91fa2ab30"
down_revision = "7c291fb804e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mail_watches",
        sa.Column(
            "connection_id",
            sa.String(36),
            sa.ForeignKey("email_connections.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("encrypted_state", sa.Text(), nullable=False),
        sa.Column("last_checked_at", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(60), nullable=False),
    )
    op.create_index("ix_mail_watches_user_id", "mail_watches", ["user_id"])
    op.create_table(
        "mail_notifications",
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
        sa.Column("encrypted_payload", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("dismissed", sa.Boolean(), nullable=False),
        sa.Column("error_code", sa.String(60), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("received_at", sa.Integer(), nullable=False),
        sa.UniqueConstraint("connection_id", "message_id"),
    )
    for field in ("user_id", "connection_id", "status", "created_at", "received_at"):
        op.create_index(f"ix_mail_notifications_{field}", "mail_notifications", [field])


def downgrade() -> None:
    op.drop_table("mail_notifications")
    op.drop_table("mail_watches")
