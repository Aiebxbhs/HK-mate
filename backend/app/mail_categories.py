"""Stored mail categories: one label per (mailbox, message). No subject, body or summary."""

import time
from uuid import uuid4

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from app.mail_summary import CATEGORIES
from app.models import EmailConnection, MailCategoryRecord, User

# Older mail is labelled for this many days back; newer mail is labelled as it arrives.
BACKFILL_DAYS = 10
# Failed attempts (e.g. the local model was down) are tried again after this long.
RETRY_FAILED_AFTER = 3600


def save_category(db: Session, user_id: str, connection_id: str, message_id: str, category: str):
    """Record a finished category, replacing any queued or older value. Caller commits."""
    if category not in CATEGORIES:
        return
    now = int(time.time())
    db.execute(
        insert(MailCategoryRecord)
        .values(
            id=str(uuid4()),
            user_id=user_id,
            connection_id=connection_id,
            message_id=message_id,
            category=category,
            status="done",
            queued_at=now * 1000,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=["connection_id", "message_id"],
            set_={"category": category, "status": "done", "updated_at": now},
            where=MailCategoryRecord.user_id == user_id,
        )
    )


def queue(db: Session, user_id: str, connection_id: str, message_ids: list[str]) -> int:
    """Queue mails (newest first) that have no category yet; retry stale failures. Commits."""
    now = int(time.time())
    base = int(time.time() * 1000)
    added = 0
    for index, message_id in enumerate(dict.fromkeys(message_ids)):
        added += db.execute(
            insert(MailCategoryRecord)
            .values(
                id=str(uuid4()),
                user_id=user_id,
                connection_id=connection_id,
                message_id=message_id,
                category="",
                status="pending",
                # Earlier in the provider's list = newer mail = classified first.
                queued_at=base - index,
                updated_at=now,
            )
            .on_conflict_do_nothing(index_elements=["connection_id", "message_id"])
        ).rowcount
    db.execute(
        update(MailCategoryRecord)
        .where(
            MailCategoryRecord.connection_id == connection_id,
            MailCategoryRecord.user_id == user_id,
            MailCategoryRecord.status == "failed",
            MailCategoryRecord.updated_at < now - RETRY_FAILED_AFTER,
        )
        .values(status="pending", updated_at=now)
    )
    db.commit()
    return added


def claim_next(db: Session) -> MailCategoryRecord | None:
    """Take the newest queued mail of an active user's connected mailbox. Commits the claim."""
    row = db.scalar(
        select(MailCategoryRecord)
        .join(EmailConnection)
        .join(User, User.id == MailCategoryRecord.user_id)
        .where(
            MailCategoryRecord.status == "pending",
            EmailConnection.status == "connected",
            EmailConnection.user_id == MailCategoryRecord.user_id,
            User.is_active.is_(True),
        )
        .order_by(MailCategoryRecord.queued_at.desc(), MailCategoryRecord.id)
        .limit(1)
    )
    if row is None:
        return None
    claimed = db.execute(
        update(MailCategoryRecord)
        .where(MailCategoryRecord.id == row.id, MailCategoryRecord.status == "pending")
        .values(status="processing", updated_at=int(time.time()))
    ).rowcount
    db.commit()
    return row if claimed else None


def finish(db: Session, row_id: str, category: str | None, gone: bool = False) -> None:
    """Store the result of a claimed row; a mail removed from Gmail drops its row. Commits."""
    if gone:
        db.execute(delete(MailCategoryRecord).where(MailCategoryRecord.id == row_id))
    else:
        db.execute(
            update(MailCategoryRecord)
            .where(MailCategoryRecord.id == row_id, MailCategoryRecord.status == "processing")
            .values(
                category=category or "",
                status="done" if category in CATEGORIES else "failed",
                updated_at=int(time.time()),
            )
        )
    db.commit()


def recover(db: Session) -> None:
    """After a restart, rows left mid-classification go back to the queue. Commits."""
    db.execute(
        update(MailCategoryRecord)
        .where(MailCategoryRecord.status == "processing")
        .values(status="pending")
    )
    db.commit()


def lookup(db: Session, user_id: str, pairs: list[tuple[str, str]]) -> dict[tuple[str, str], dict]:
    """Category and status for the given (connection_id, message_id) pairs of one user."""
    if not pairs:
        return {}
    rows = db.scalars(
        select(MailCategoryRecord).where(
            MailCategoryRecord.user_id == user_id,
            or_(
                *(
                    and_(
                        MailCategoryRecord.connection_id == cid,
                        MailCategoryRecord.message_id == mid,
                    )
                    for cid, mid in dict.fromkeys(pairs)
                )
            ),
        )
    )
    return {
        (row.connection_id, row.message_id): {
            "category": row.category if row.status == "done" else None,
            # A failed attempt shows no label until the backfill scan retries it.
            "status": {"done": "done", "failed": None}.get(row.status, "pending"),
        }
        for row in rows
    }
