"""Add encrypted home-assistant conversations and memories."""

import sqlalchemy as sa
from alembic import op

revision = "d5e3f7a1b2c8"
down_revision = "c4d2e8f1a9b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_conversations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        # Title, running summary and messages (Fernet-encrypted JSON).
        sa.Column("encrypted_payload", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_agent_conversations_user_updated", "agent_conversations", ["user_id", "updated_at"]
    )
    op.create_table(
        "agent_memories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("encrypted_fact", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
    )
    op.create_index("ix_agent_memories_user", "agent_memories", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_memories_user", table_name="agent_memories")
    op.drop_table("agent_memories")
    op.drop_index("ix_agent_conversations_user_updated", table_name="agent_conversations")
    op.drop_table("agent_conversations")
