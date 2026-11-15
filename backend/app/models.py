from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(60))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[int] = mapped_column(Integer)


class LoginSession(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class AuthRateLimit(Base):
    __tablename__ = "auth_rate_limits"
    bucket_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    window_started_at: Mapped[int] = mapped_column(Integer, index=True)
    attempt_count: Mapped[int] = mapped_column(Integer)
    blocked_until: Mapped[int] = mapped_column(Integer)


class EmailConnection(Base):
    __tablename__ = "email_connections"
    __table_args__ = (UniqueConstraint("provider", "email_address"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20), default="google")
    email_address: Mapped[str] = mapped_column(String(254))
    encrypted_credentials: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="connected")
    created_at: Mapped[int] = mapped_column(Integer)


class MailOAuthState(Base):
    __tablename__ = "mail_oauth_states"
    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    session_hash: Mapped[str] = mapped_column(String(64))
    encrypted_verifier: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class MailPage(Base):
    __tablename__ = "mail_pages"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    encrypted_state: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    __table_args__ = (UniqueConstraint("user_id", "source", "external_uid"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(30))
    external_uid: Mapped[str] = mapped_column(String(1024))
    title: Mapped[str] = mapped_column(Text)
    location: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    starts_at: Mapped[int] = mapped_column(Integer, index=True)
    ends_at: Mapped[int] = mapped_column(Integer)
    imported_at: Mapped[int] = mapped_column(Integer)
    # "event" has a start and end; "deadline" is a single due time (starts_at == ends_at).
    kind: Mapped[str] = mapped_column(String(20), default="event", server_default="event")
    completed_at: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)


class MailWatch(Base):
    __tablename__ = "mail_watches"
    connection_id: Mapped[str] = mapped_column(
        ForeignKey("email_connections.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    encrypted_state: Mapped[str] = mapped_column(Text)
    last_checked_at: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str] = mapped_column(String(60), default="")


class MailNotification(Base):
    __tablename__ = "mail_notifications"
    __table_args__ = (UniqueConstraint("connection_id", "message_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    connection_id: Mapped[str] = mapped_column(
        ForeignKey("email_connections.id", ondelete="CASCADE"), index=True
    )
    message_id: Mapped[str] = mapped_column(String(128))
    encrypted_payload: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), index=True, default="pending")
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False)
    error_code: Mapped[str] = mapped_column(String(60), default="")
    created_at: Mapped[int] = mapped_column(Integer, index=True)
    received_at: Mapped[int] = mapped_column(Integer, index=True)


class MailCategoryRecord(Base):
    """One category per mail. Holds no subject, body or summary: only ids and the label."""

    __tablename__ = "mail_categories"
    __table_args__ = (UniqueConstraint("connection_id", "message_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    connection_id: Mapped[str] = mapped_column(
        ForeignKey("email_connections.id", ondelete="CASCADE"), index=True
    )
    message_id: Mapped[str] = mapped_column(String(128))
    category: Mapped[str] = mapped_column(String(20), default="")
    # pending -> processing -> done; failed rows are retried later by the backfill scan.
    status: Mapped[str] = mapped_column(String(20), index=True, default="pending")
    queued_at: Mapped[int] = mapped_column(Integer, index=True)
    updated_at: Mapped[int] = mapped_column(Integer)


class LectureRecord(Base):
    """A saved lecture. Course name/code stay plain for grouping; everything else is encrypted."""

    __tablename__ = "lecture_records"
    __table_args__ = (Index("ix_lecture_records_user_started", "user_id", "started_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    course_name: Mapped[str] = mapped_column(String(100))
    course_code: Mapped[str] = mapped_column(String(40), default="", server_default="")
    started_at: Mapped[int] = mapped_column(Integer)
    ended_at: Mapped[int] = mapped_column(Integer)
    recorded_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    encrypted_payload: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[int] = mapped_column(Integer)


class AgentConversation(Base):
    """A saved home-assistant conversation; title, summary and messages are encrypted."""

    __tablename__ = "agent_conversations"
    __table_args__ = (Index("ix_agent_conversations_user_updated", "user_id", "updated_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    encrypted_payload: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[int] = mapped_column(Integer)


class AgentMemory(Base):
    """One short fact the assistant remembers about the user (encrypted)."""

    __tablename__ = "agent_memories"
    __table_args__ = (Index("ix_agent_memories_user", "user_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    encrypted_fact: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[int] = mapped_column(Integer)
