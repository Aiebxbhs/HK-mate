from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ConnectionOutput(BaseModel):
    id: str
    provider: str
    email_address: str
    status: str
    created_at: datetime


class ConnectionsOutput(BaseModel):
    items: list[ConnectionOutput]
    google_configured: bool


class AuthorizeOutput(BaseModel):
    authorization_url: str


class MailSummary(BaseModel):
    id: str
    connection_id: str
    mailbox: str
    subject: str
    sender: str
    received_at: datetime
    snippet: str
    unread: bool
    # Filled from mail_categories when listing; "pending" while the label is queued.
    category: str | None = None
    category_status: Literal["pending", "done"] | None = None


class MailDetail(MailSummary):
    recipients: str
    body: str
    attachments: list[str] = Field(default_factory=list)


class MailIssue(BaseModel):
    connection_id: str
    message: str


class MailList(BaseModel):
    items: list[MailSummary]
    next_cursor: str | None = None
    issues: list[MailIssue] = Field(default_factory=list)
