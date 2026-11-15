"""Add user-owned lecture records (course info plus encrypted notes and summaries)."""

import sqlalchemy as sa
from alembic import op

revision = "c4d2e8f1a9b6"
down_revision = "b3f1c9d2a7e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lecture_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("course_name", sa.String(100), nullable=False),
        sa.Column("course_code", sa.String(40), nullable=False, server_default=""),
        sa.Column("started_at", sa.Integer(), nullable=False),
        sa.Column("ended_at", sa.Integer(), nullable=False),
        sa.Column("recorded_seconds", sa.Integer(), nullable=False, server_default="0"),
        # Instructor, extra info, notes, summary and transcript (Fernet-encrypted JSON).
        sa.Column("encrypted_payload", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
    )
    op.create_index("ix_lecture_records_user_started", "lecture_records", ["user_id", "started_at"])


def downgrade() -> None:
    op.drop_index("ix_lecture_records_user_started", table_name="lecture_records")
    op.drop_table("lecture_records")
