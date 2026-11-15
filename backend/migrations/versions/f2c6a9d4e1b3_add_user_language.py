"""Add the account interface language (zh or en); existing accounts stay Chinese."""

import sqlalchemy as sa
from alembic import op

revision = "f2c6a9d4e1b3"
down_revision = "e8b4c2d7f6a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("language", sa.String(5), nullable=False, server_default="zh"))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("language")
