"""Use usernames while preserving existing users, passwords and sessions."""

import sqlalchemy as sa
from alembic import op

revision = "72bd536d9601"
down_revision = "541e8663222b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_users_email", table_name="users")
    op.alter_column("users", "email", new_column_name="username", existing_type=sa.String(254))
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.alter_column("users", "username", new_column_name="email", existing_type=sa.String(254))
    op.create_index("ix_users_email", "users", ["email"], unique=True)
