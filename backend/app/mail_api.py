from typing import Literal

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import mail_categories, netease, services
from app.api import database
from app.core.security import SESSION_COOKIE
from app.i18n import request_language
from app.mail_reply import (
    ComposeRequest,
    DraftError,
    ReplyIntent,
    ReplyLanguage,
    ReplyRequest,
    ReplyTone,
)
from app.mail_schemas import (
    AuthorizeOutput,
    ConnectionOutput,
    ConnectionsOutput,
    MailDetail,
    MailList,
)
from app.mail_service import connection_output, owned
from app.mail_summary import MODEL, EmailSummary, SummaryError
from app.models import EmailConnection
from app.schemas import ErrorOutput
from app.services import AuthError

router = APIRouter(
    prefix="/api/v1",
    responses={
        code: {"model": ErrorOutput}
        for code in (400, 401, 403, 404, 409, 410, 413, 422, 429, 502, 503)
    },
)


@router.get("/email-connections", response_model=ConnectionsOutput)
def connections(request: Request, db: Session = Depends(database)) -> ConnectionsOutput:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    rows = db.scalars(
        select(EmailConnection)
        .where(EmailConnection.user_id == user.id)
        .order_by(EmailConnection.created_at)
    )
    return ConnectionsOutput(
        items=[connection_output(row) for row in rows],
        google_configured=request.app.state.mail.google.configured(),
    )


@router.post("/email-connections/google/authorize", response_model=AuthorizeOutput)
def authorize(request: Request, db: Session = Depends(database)) -> AuthorizeOutput:
    token = request.cookies.get(SESSION_COOKIE)
    user = services.current_user(db, token)
    services.check_rate_limit(db, "mail-authorize", user.id, request.client.host)
    return AuthorizeOutput(authorization_url=request.app.state.mail.authorize(db, user.id, token))


@router.get("/email-connections/google/callback", include_in_schema=False)
def callback(
    request: Request,
    state: str = "",
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(database),
) -> Response:
    result = "failed"
    try:
        token = request.cookies.get(SESSION_COOKIE)
        user = services.current_user(db, token)
        if len(state) > 200 or not state or (code and len(code) > 4096):
            raise AuthError("OAUTH_STATE_INVALID", "授权请求无效。", 400)
        request.app.state.mail.callback(db, user.id, token, state, code, error)
        result = "connected"
    except AuthError as exc:
        result = {
            "OAUTH_CANCELLED": "cancelled",
            "OAUTH_STATE_INVALID": "expired",
            "AUTHENTICATION_REQUIRED": "login_required",
            "MAILBOX_ALREADY_LINKED": "already_linked",
        }.get(exc.code, "failed")
    return RedirectResponse(
        request.app.state.settings.web_url.rstrip("/") + "/?gmail=" + result,
        status_code=303,
        headers={"Referrer-Policy": "no-referrer"},
    )


class NeteaseConnectInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email_address: str = Field(pattern=netease.ADDRESS, max_length=80)
    # Client authorization code from the web mailbox's IMAP settings, not the login password.
    authorization_code: str = Field(pattern=r"^[A-Za-z0-9]{8,64}$")


@router.post("/email-connections/netease", response_model=ConnectionOutput, status_code=201)
def connect_netease(
    payload: NeteaseConnectInput, request: Request, db: Session = Depends(database)
) -> ConnectionOutput:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    services.check_rate_limit(db, "mail-authorize", user.id, request.client.host)
    row = request.app.state.mail.connect_netease(
        db, user.id, payload.email_address.lower(), payload.authorization_code
    )
    return connection_output(row)


@router.delete("/email-connections/{connection_id}", status_code=204)
def disconnect(connection_id: str, request: Request, db: Session = Depends(database)) -> Response:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    request.app.state.mail.disconnect(db, user.id, connection_id)
    return Response(status_code=204)


@router.get("/messages", response_model=MailList)
def messages(
    request: Request,
    scope: Literal["inbox", "received"] = "inbox",
    cursor: str | None = Query(None, max_length=64),
    connection_id: str | None = Query(None, max_length=36),
    db: Session = Depends(database),
) -> MailList:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    return request.app.state.mail.messages(db, user.id, scope, cursor, connection_id)


@router.get("/email-connections/{connection_id}/messages/{message_id}", response_model=MailDetail)
def message(
    request: Request,
    connection_id: str,
    message_id: str = Path(pattern=r"^[A-Za-z0-9_-]{1,128}$"),
    db: Session = Depends(database),
) -> MailDetail:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    return request.app.state.mail.message(db, user.id, connection_id, message_id)


class MailSummaryOutput(BaseModel):
    summary: EmailSummary
    model: str
    elapsed_seconds: float


@router.post(
    "/email-connections/{connection_id}/messages/{message_id}/summary",
    response_model=MailSummaryOutput,
)
def summarize_message(
    request: Request,
    connection_id: str,
    message_id: str = Path(pattern=r"^[A-Za-z0-9_-]{1,128}$"),
    db: Session = Depends(database),
) -> MailSummaryOutput:
    user_id = services.current_user(db, request.cookies.get(SESSION_COOKIE)).id
    owned(db, user_id, connection_id)
    if not request.app.state.summary_lock.acquire(blocking=False):
        raise AuthError("SUMMARY_BUSY", "本地模型正在处理其他邮件，请稍后重试。", 503)
    try:
        mail = request.app.state.mail.message(db, user_id, connection_id, message_id)
        db.rollback()  # Release the read transaction before potentially long local inference.
        try:
            result = request.app.state.summarizer.summarize(mail, request_language(request))
        except SummaryError as exc:
            code = str(exc)
            known = {
                "SUMMARY_TIMEOUT": ("本地模型生成超时，请稍后重试。", 503),
                "SUMMARY_LOCAL_SERVICE_UNAVAILABLE": ("请启动本地 Ollama 并确认模型已下载。", 503),
                "SUMMARY_INPUT_TOO_LONG": ("邮件过长，超出本地模型可处理的长度。", 413),
            }
            message, status = known.get(
                code, ("本次摘要未通过内容或格式检查，请重试并核对原邮件。", 502)
            )
            raise AuthError(
                code if code in known else "SUMMARY_VALIDATION_FAILED", message, status
            ) from None
        # The summary is not kept, but its category labels this mail in the inbox.
        mail_categories.save_category(
            db, user_id, connection_id, message_id, result.summary.category
        )
        db.commit()
        return MailSummaryOutput(
            summary=result.summary, model=MODEL, elapsed_seconds=result.elapsed_seconds
        )
    finally:
        request.app.state.summary_lock.release()


class ReplyDraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intent: ReplyIntent
    note: str = Field(default="", max_length=500)
    tone: ReplyTone = "formal"
    language: ReplyLanguage = "auto"
    signature: str = Field(default="", max_length=60)


class ReplyDraftOutput(BaseModel):
    body: str
    missing_info: list[str]
    to_address: str
    to_name: str
    subject: str
    mailbox: str
    model: str
    elapsed_seconds: float


@router.post(
    "/email-connections/{connection_id}/messages/{message_id}/reply-draft",
    response_model=ReplyDraftOutput,
)
def draft_reply(
    body: ReplyDraftInput,
    request: Request,
    connection_id: str,
    message_id: str = Path(pattern=r"^[A-Za-z0-9_-]{1,128}$"),
    db: Session = Depends(database),
) -> ReplyDraftOutput:
    """Draft only: nothing is sent, saved to Gmail, or stored here."""
    user_id = services.current_user(db, request.cookies.get(SESSION_COOKIE)).id
    owned(db, user_id, connection_id)
    if body.intent == "custom" and not body.note.strip():
        raise AuthError("REPLY_NOTE_REQUIRED", "请先写下想回复的内容要点。", 400)
    if not request.app.state.summary_lock.acquire(blocking=False):
        raise AuthError("SUMMARY_BUSY", "本地模型正在处理其他邮件，请稍后重试。", 503)
    try:
        mail = request.app.state.mail.message(db, user_id, connection_id, message_id)
        db.rollback()  # Release the read transaction before potentially long local inference.
        try:
            draft = request.app.state.reply_drafter.draft(
                mail,
                ReplyRequest(
                    intent=body.intent,
                    note=body.note.strip(),
                    tone=body.tone,
                    language=body.language,
                    signature=body.signature.strip(),
                    interface=request_language(request),
                ),
            )
        except DraftError as exc:
            code = str(exc)
            known = {
                "REPLY_TIMEOUT": ("本地模型生成超时，请稍后重试。", 503),
                "REPLY_LOCAL_SERVICE_UNAVAILABLE": ("请启动本地 Ollama 并确认模型已下载。", 503),
                "REPLY_INPUT_TOO_LONG": ("邮件过长，超出本地模型可处理的长度。", 413),
                "REPLY_NO_RECIPIENT": ("无法识别原邮件的发件人地址，不能起草回复。", 422),
            }
            message, status = known.get(code, ("本次草稿未通过格式检查，请重新生成。", 502))
            raise AuthError(code if code in known else "REPLY_INVALID", message, status) from None
        return ReplyDraftOutput(
            body=draft.body,
            missing_info=draft.missing_info,
            to_address=draft.to_address,
            to_name=draft.to_name,
            subject=draft.subject,
            mailbox=mail.mailbox,
            model=MODEL,
            elapsed_seconds=draft.elapsed_seconds,
        )
    finally:
        request.app.state.summary_lock.release()


class ComposeDraftInput(BaseModel):
    """A brand-new email. The recipient's address stays in the browser; only a name is sent."""

    model_config = ConfigDict(extra="forbid")
    purpose: str = Field(min_length=1, max_length=1000)
    recipient: str = Field(default="", max_length=100)
    tone: ReplyTone = "formal"
    language: ReplyLanguage = "auto"
    signature: str = Field(default="", max_length=60)


class ComposeDraftOutput(BaseModel):
    subject: str
    body: str
    missing_info: list[str]
    model: str
    elapsed_seconds: float


@router.post("/compose-draft", response_model=ComposeDraftOutput)
def draft_new_mail(
    body: ComposeDraftInput, request: Request, db: Session = Depends(database)
) -> ComposeDraftOutput:
    """Draft only: nothing is sent, saved to Gmail, or stored here."""
    services.current_user(db, request.cookies.get(SESSION_COOKIE))
    if not body.purpose.strip():
        raise AuthError("COMPOSE_PURPOSE_REQUIRED", "请先写下这封邮件要说的内容。", 400)
    db.rollback()  # No database work is needed during local inference.
    if not request.app.state.summary_lock.acquire(blocking=False):
        raise AuthError("SUMMARY_BUSY", "本地模型正在处理其他邮件，请稍后重试。", 503)
    try:
        draft = request.app.state.reply_drafter.compose(
            ComposeRequest(
                purpose=body.purpose.strip(),
                recipient=body.recipient.strip(),
                tone=body.tone,
                language=body.language,
                signature=body.signature.strip(),
                interface=request_language(request),
            )
        )
    except DraftError as exc:
        code = str(exc)
        known = {
            "REPLY_TIMEOUT": ("本地模型生成超时，请稍后重试。", 503),
            "REPLY_LOCAL_SERVICE_UNAVAILABLE": ("请启动本地 Ollama 并确认模型已下载。", 503),
            "REPLY_INPUT_TOO_LONG": ("内容过长，超出本地模型可处理的长度。", 413),
        }
        message, status = known.get(code, ("本次草稿未通过格式检查，请重新生成。", 502))
        raise AuthError(code if code in known else "REPLY_INVALID", message, status) from None
    finally:
        request.app.state.summary_lock.release()
    return ComposeDraftOutput(
        subject=draft.subject,
        body=draft.body,
        missing_info=draft.missing_info,
        model=MODEL,
        elapsed_seconds=draft.elapsed_seconds,
    )
