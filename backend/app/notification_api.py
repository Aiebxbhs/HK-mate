import json
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app import mail_categories, services
from app.api import database
from app.core.security import SESSION_COOKIE
from app.i18n import request_language, tr
from app.mail_summary import EmailSummary
from app.models import EmailConnection, MailNotification, MailWatch
from app.schemas import ErrorOutput
from app.services import AuthError

router = APIRouter(
    prefix="/api/v1/mail-notifications",
    responses={code: {"model": ErrorOutput} for code in (400, 401, 403, 404, 409, 503)},
)


def error_message(code: str) -> str:
    return {
        "MAIL_REAUTHORIZE": "邮箱授权已失效，请在邮箱管理中重新连接。",
        "MAIL_KEY_UNAVAILABLE": "本机邮箱加密密钥不可用，请检查或恢复密钥。",
        "MAIL_PROVIDER_LIMITED": "邮箱服务暂时限制了访问，系统会稍后重试。",
        "SUMMARY_TIMEOUT": "本地摘要生成超时，可以重试。",
        "SUMMARY_LOCAL_SERVICE_UNAVAILABLE": "本地模型不可用，请启动 Ollama 后重试。",
        "SUMMARY_UNSUPPORTED_DEADLINE": "摘要中的截止时间未通过原文校验，请重试并核对原邮件。",
        "SUMMARY_INPUT_TOO_LONG": "邮件过长，超出本地模型可处理的长度，请直接阅读原邮件。",
    }.get(code, "邮件检测或摘要未能完成，请检查连接或重试。")


class NotificationOutput(BaseModel):
    id: str
    connection_id: str
    message_id: str
    subject: str
    sender: str
    mailbox: str
    received_at: datetime
    status: Literal["pending", "processing", "ready", "failed"]
    summary: EmailSummary | None
    # The stored label (backfill or summary); it may arrive before or replace the summary's.
    category: str | None = None
    error: str | None


class NotificationsOutput(BaseModel):
    enabled: bool
    connection_count: int
    total_count: int
    last_checked_at: datetime | None
    errors: list[str]
    items: list[NotificationOutput]
    next_cursor: str | None


def owned_notification(db: Session, owner: str, notification_id: str) -> MailNotification:
    row = db.scalar(
        select(MailNotification).where(
            MailNotification.id == notification_id, MailNotification.user_id == owner
        )
    )
    if row is None:
        raise AuthError("NOTIFICATION_NOT_FOUND", "新邮件通知不存在。", 404)
    return row


@router.get("", response_model=NotificationsOutput)
def notifications(
    request: Request,
    cursor: str | None = Query(None, max_length=36),
    db: Session = Depends(database),
) -> NotificationsOutput:
    owner = services.current_user(db, request.cookies.get(SESSION_COOKIE)).id
    ownership = (
        MailNotification.user_id == owner,
        MailNotification.dismissed.is_(False),
        EmailConnection.status == "connected",
    )
    query = select(MailNotification).join(EmailConnection).where(*ownership)
    if cursor:
        before = owned_notification(db, owner, cursor)
        query = query.where(
            or_(
                MailNotification.received_at < before.received_at,
                and_(
                    MailNotification.received_at == before.received_at,
                    MailNotification.id < before.id,
                ),
            )
        )
    rows = list(
        db.scalars(
            query.order_by(MailNotification.received_at.desc(), MailNotification.id.desc()).limit(
                101
            )
        )
    )
    watches = list(db.scalars(select(MailWatch).where(MailWatch.user_id == owner)))
    connections = list(db.scalars(select(EmailConnection).where(EmailConnection.user_id == owner)))
    codes = [row.error_code for row in watches if row.error_code]
    if any(row.status == "reauthorization_required" for row in connections):
        codes.append("MAIL_REAUTHORIZE")
    if request.app.state.monitor.error_code:
        codes.append(request.app.state.monitor.error_code)
    language = request_language(request)
    items = []
    labels = mail_categories.lookup(
        db, owner, [(row.connection_id, row.message_id) for row in rows[:100]]
    )
    for row in rows[:100]:
        payload = json.loads(request.app.state.mail.vault.decrypt(row.encrypted_payload))
        metadata = payload["mail"]
        items.append(
            NotificationOutput(
                id=row.id,
                connection_id=row.connection_id,
                message_id=row.message_id,
                subject=metadata["subject"],
                sender=metadata["sender"],
                mailbox=metadata["mailbox"],
                received_at=metadata["received_at"],
                status=row.status,
                summary=payload.get("summary"),
                category=labels.get((row.connection_id, row.message_id), {}).get("category"),
                error=tr(error_message(row.error_code), language) if row.error_code else None,
            )
        )
        item = items[-1]
        if item.category and item.summary:
            item.summary.category = item.category
        elif item.summary and not item.category:
            item.category = item.summary.category
    checked = min((row.last_checked_at for row in watches), default=0)
    return NotificationsOutput(
        enabled=request.app.state.settings.auto_mail_enabled,
        connection_count=len(connections),
        total_count=db.scalar(
            select(func.count())
            .select_from(MailNotification)
            .join(EmailConnection)
            .where(*ownership)
        )
        or 0,
        last_checked_at=datetime.fromtimestamp(checked, UTC) if checked else None,
        errors=list(dict.fromkeys(tr(error_message(code), language) for code in codes)),
        items=items,
        next_cursor=rows[99].id if len(rows) > 100 else None,
    )


@router.post("/check", status_code=204)
def check(request: Request, db: Session = Depends(database)) -> Response:
    services.current_user(db, request.cookies.get(SESSION_COOKIE))
    if not request.app.state.settings.auto_mail_enabled:
        raise AuthError("MONITOR_DISABLED", "自动邮件检测未开启。", 503)
    request.app.state.monitor.wakeup.set()
    return Response(status_code=204)


@router.post("/{notification_id}/dismiss", status_code=204)
def dismiss(notification_id: str, request: Request, db: Session = Depends(database)) -> Response:
    owner = services.current_user(db, request.cookies.get(SESSION_COOKIE)).id
    row = owned_notification(db, owner, notification_id)
    row.dismissed = True
    db.commit()
    return Response(status_code=204)


@router.post("/{notification_id}/retry", status_code=204)
def retry(notification_id: str, request: Request, db: Session = Depends(database)) -> Response:
    owner = services.current_user(db, request.cookies.get(SESSION_COOKIE)).id
    row = owned_notification(db, owner, notification_id)
    if row.dismissed or row.status != "failed":
        raise AuthError("NOTIFICATION_NOT_RETRYABLE", "这封邮件当前无法重试。", 409)
    connection = db.get(EmailConnection, row.connection_id)
    if not connection or connection.status != "connected":
        raise AuthError("MAIL_REAUTHORIZE", "请重新连接邮箱后重试。", 409)
    row.status, row.error_code = "pending", ""
    db.commit()
    return Response(status_code=204)
