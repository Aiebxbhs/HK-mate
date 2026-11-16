import json
import secrets
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from uuid import uuid4

import httpx
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import mail_categories, netease
from app.core.security import hash_token
from app.gmail import GoogleMailbox, TokenVault, detail, summary
from app.mail_schemas import ConnectionOutput, MailIssue, MailList, MailSummary
from app.models import EmailConnection, LoginSession, MailOAuthState, MailPage
from app.netease import NeteaseMailbox
from app.services import AuthError


def connection_output(row: EmailConnection) -> ConnectionOutput:
    return ConnectionOutput(
        id=row.id,
        provider=row.provider,
        email_address=row.email_address,
        status=row.status,
        created_at=datetime.fromtimestamp(row.created_at, UTC),
    )


def owned(db: Session, user_id: str, connection_id: str) -> EmailConnection:
    row = db.scalar(
        select(EmailConnection).where(
            EmailConnection.id == connection_id, EmailConnection.user_id == user_id
        )
    )
    if row is None:
        raise AuthError("MAILBOX_NOT_FOUND", "邮箱连接不存在。", 404)
    return row


class MailService:
    def __init__(
        self, google: GoogleMailbox, vault: TokenVault, netease_mail: NeteaseMailbox | None = None
    ):
        self.google, self.vault = google, vault
        self.netease = netease_mail or NeteaseMailbox()

    def connect_netease(
        self, db: Session, user_id: str, address: str, code: str
    ) -> EmailConnection:
        """Link a 163 / 126 / yeah.net mailbox after one successful read-only sign-in."""
        existing = db.scalar(select(EmailConnection.id).limit(1))
        self.vault.cipher(create=existing is None)
        db.rollback()
        token = netease.credentials(address, code)
        self.netease.verify(token)
        row = db.scalar(
            select(EmailConnection).where(
                EmailConnection.provider == netease.PROVIDER,
                EmailConnection.email_address == address,
            )
        )
        if row and row.user_id != user_id:
            raise AuthError("MAILBOX_ALREADY_LINKED", "该邮箱已绑定其他平台账号，请先解绑。", 409)
        if not row:
            count = len(
                list(
                    db.scalars(select(EmailConnection.id).where(EmailConnection.user_id == user_id))
                )
            )
            if count >= 5:
                raise AuthError("MAILBOX_LIMIT", "当前最多连接 5 个邮箱。", 409)
            row = EmailConnection(
                id=str(uuid4()),
                user_id=user_id,
                provider=netease.PROVIDER,
                email_address=address,
                created_at=int(time.time()),
            )
        row.encrypted_credentials = self.vault.encrypt(token)
        row.status = "connected"
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise AuthError(
                "MAILBOX_ALREADY_LINKED", "该邮箱已连接，请刷新邮箱管理。", 409
            ) from None
        return row

    def reauthorize(self, db: Session, user_id: str, connection_id: str) -> None:
        db.execute(
            update(EmailConnection)
            .where(EmailConnection.id == connection_id, EmailConnection.user_id == user_id)
            .values(status="reauthorization_required")
        )
        db.commit()

    def authorize(self, db: Session, user_id: str, session_token: str) -> str:
        existing = db.scalar(select(EmailConnection.id).limit(1))
        self.vault.cipher(create=existing is None)
        state = secrets.token_urlsafe(40)
        url, verifier = self.google.authorization(state)
        db.execute(delete(MailOAuthState).where(MailOAuthState.expires_at <= int(time.time())))
        db.add(
            MailOAuthState(
                state_hash=hash_token(state),
                user_id=user_id,
                session_hash=hash_token(session_token),
                encrypted_verifier=self.vault.encrypt(verifier),
                expires_at=int(time.time()) + 600,
            )
        )
        db.commit()
        return url

    def callback(
        self,
        db: Session,
        user_id: str,
        session_token: str,
        state: str,
        code: str | None,
        error: str | None,
    ) -> None:
        pending = db.execute(
            delete(MailOAuthState)
            .where(
                MailOAuthState.state_hash == hash_token(state),
                MailOAuthState.user_id == user_id,
                MailOAuthState.session_hash == hash_token(session_token),
                MailOAuthState.expires_at > int(time.time()),
            )
            .returning(MailOAuthState.encrypted_verifier)
        ).scalar_one_or_none()
        db.commit()
        if pending is None:
            raise AuthError(
                "OAUTH_STATE_INVALID", "授权请求已过期或不属于当前登录，请重新连接。", 400
            )
        if error or not code:
            raise AuthError("OAUTH_CANCELLED", "Google 授权已取消。", 400)
        serialized = self.google.exchange(code, self.vault.decrypt(pending))
        token, serialized = self.google.refresh(serialized)
        email = self.google.profile(token)
        row = db.scalar(
            select(EmailConnection).where(
                EmailConnection.provider == "google", EmailConnection.email_address == email
            )
        )
        if row and row.user_id != user_id:
            raise AuthError("MAILBOX_ALREADY_LINKED", "该邮箱已绑定其他平台账号，请先解绑。", 409)
        # The session may have been logged out during the Google exchange.
        active = db.scalar(
            select(LoginSession.id).where(
                LoginSession.token_hash == hash_token(session_token),
                LoginSession.user_id == user_id,
                LoginSession.expires_at > int(time.time()),
            )
        )
        if not active:
            raise AuthError("AUTHENTICATION_REQUIRED", "请重新登录后连接邮箱。", 401)
        if not row:
            count = len(
                list(
                    db.scalars(select(EmailConnection.id).where(EmailConnection.user_id == user_id))
                )
            )
            if count >= 5:
                raise AuthError("MAILBOX_LIMIT", "当前最多连接 5 个邮箱。", 409)
            row = EmailConnection(
                id=str(uuid4()),
                user_id=user_id,
                provider="google",
                email_address=email,
                created_at=int(time.time()),
                status="connected",
            )
        row.encrypted_credentials = self.vault.encrypt(serialized)
        row.status = "connected"
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise AuthError(
                "MAILBOX_ALREADY_LINKED", "该邮箱已连接，请刷新邮箱管理。", 409
            ) from None

    def access(self, db: Session, user_id: str, connection_id: str) -> tuple[EmailConnection, str]:
        row = owned(db, user_id, connection_id)
        if row.status == "revocation_pending":
            raise AuthError("MAIL_DISCONNECTED", "该邮箱已停止访问，请重试完成解绑。", 409)
        if row.status == "reauthorization_required":
            raise AuthError("MAIL_REAUTHORIZE", "邮箱授权已失效，请重新连接。", 401)
        encrypted = row.encrypted_credentials
        db.rollback()
        if row.provider == netease.PROVIDER:
            # The authorization code is used as it is; there is nothing to refresh.
            return row, self.vault.decrypt(encrypted)
        try:
            token, serialized = self.google.refresh(self.vault.decrypt(encrypted))
        except AuthError as exc:
            if exc.code == "MAIL_REAUTHORIZE":
                db.execute(
                    update(EmailConnection)
                    .where(EmailConnection.id == connection_id, EmailConnection.user_id == user_id)
                    .values(status="reauthorization_required")
                )
                db.commit()
            raise
        changed = db.execute(
            update(EmailConnection)
            .where(
                EmailConnection.id == connection_id,
                EmailConnection.user_id == user_id,
                EmailConnection.status == "connected",
            )
            .values(encrypted_credentials=self.vault.encrypt(serialized))
        ).rowcount
        db.commit()
        if changed != 1:
            raise AuthError("MAIL_DISCONNECTED", "邮箱已断开，请刷新页面。", 409)
        return row, token

    def disconnect(self, db: Session, user_id: str, connection_id: str) -> None:
        row = owned(db, user_id, connection_id)
        if row.provider == netease.PROVIDER:
            # No provider-side revocation exists; the user deletes the code in the web mailbox.
            db.execute(delete(MailPage).where(MailPage.user_id == user_id))
            db.execute(
                delete(EmailConnection).where(
                    EmailConnection.id == connection_id, EmailConnection.user_id == user_id
                )
            )
            db.commit()
            return
        credentials = json.loads(self.vault.decrypt(row.encrypted_credentials))
        row.status = "revocation_pending"
        db.execute(delete(MailPage).where(MailPage.user_id == user_id))
        db.commit()  # Stop local access even if the provider is unavailable.
        try:
            result = httpx.post(
                "https://oauth2.googleapis.com/revoke",
                data={"token": credentials.get("refresh_token") or credentials["token"]},
                timeout=12,
            )
            if result.status_code != 200 and not (
                result.status_code == 400 and result.json().get("error") == "invalid_token"
            ):
                raise ValueError()
        except (httpx.HTTPError, ValueError, KeyError):
            raise AuthError(
                "MAIL_REVOCATION_PENDING", "本地访问已停止，Google 撤销暂未完成，请重试解绑。", 502
            ) from None
        db.execute(
            delete(EmailConnection).where(
                EmailConnection.id == connection_id, EmailConnection.user_id == user_id
            )
        )
        db.commit()

    def messages(
        self, db: Session, user_id: str, scope: str, cursor: str | None, connection_id: str | None
    ) -> MailList:
        rows = list(db.scalars(select(EmailConnection).where(EmailConnection.user_id == user_id)))
        if connection_id:
            rows = [owned(db, user_id, connection_id)]
        allowed = {row.id: row.email_address for row in rows}
        providers = {row.id: row.provider for row in rows}
        if cursor:
            cached = db.scalar(
                select(MailPage).where(
                    MailPage.id == cursor,
                    MailPage.user_id == user_id,
                    MailPage.expires_at > int(time.time()),
                )
            )
            if cached is None:
                raise AuthError("MAIL_PAGE_EXPIRED", "邮件分页已过期，请刷新列表。", 410)
            state = json.loads(self.vault.decrypt(cached.encrypted_state))
            if state["scope"] != scope or state["connection_id"] != connection_id:
                raise AuthError("MAIL_PAGE_INVALID", "分页条件已改变，请刷新列表。", 400)
        else:
            state = {
                "scope": scope,
                "connection_id": connection_id,
                "accounts": {
                    key: {"items": [], "next": None, "started": False, "done": False}
                    for key in allowed
                },
            }
        state["accounts"] = {
            key: value for key, value in state["accounts"].items() if key in allowed
        }
        db.rollback()
        issues, tokens, failed = [], {}, set()

        def fill(key: str, queue: dict) -> None:
            if queue["items"] or queue["done"] or key in failed:
                return
            try:
                if key not in tokens:
                    _, tokens[key] = self.access(db, user_id, key)
                if providers[key] == netease.PROVIDER:
                    # One sign-in per page: the inbox only, whatever the scope.
                    found, queue["next"] = self.netease.page(
                        tokens[key], queue["next"], key, allowed[key]
                    )
                    queue["items"] = [item.model_dump(mode="json") for item in found]
                    queue["started"] = True
                    queue["done"] = not bool(queue["next"])
                    return
                # A bounded number of empty provider pages avoids an endless loop.
                for _ in range(3):
                    page = self.google.page(tokens[key], queue["next"], scope)
                    ids = [item["id"] for item in page.get("messages", [])]
                    if len(ids) > 20:
                        raise ValueError("Unexpected provider page size")

                    def read(message_id):
                        try:
                            raw = self.google.message(tokens[key], message_id)
                            return summary(raw, key, allowed[key]).model_dump(mode="json")
                        except AuthError as exc:
                            if exc.code == "MAIL_NOT_FOUND":
                                return None
                            raise

                    with ThreadPoolExecutor(max_workers=5) as pool:
                        queue["items"] = [item for item in pool.map(read, ids) if item is not None]
                    queue["next"] = page.get("nextPageToken")
                    queue["started"] = True
                    queue["done"] = not bool(queue["next"])
                    if queue["items"] or queue["done"]:
                        break
            except AuthError as exc:
                failed.add(key)
                issues.append(MailIssue(connection_id=key, message=exc.message))
                if exc.code == "MAIL_REAUTHORIZE":
                    self.reauthorize(db, user_id, key)
            except (ValueError, KeyError, TypeError):
                failed.add(key)
                issues.append(
                    MailIssue(
                        connection_id=key, message="Gmail 返回的数据暂时无法处理，请刷新重试。"
                    )
                )

        items = []
        for _ in range(20):
            for key, queue in state["accounts"].items():
                fill(key, queue)
            candidates = [
                (key, queue["items"][0])
                for key, queue in state["accounts"].items()
                if queue["items"] and key not in failed
            ]
            if not candidates:
                break
            key, item = max(
                candidates,
                key=lambda pair: (
                    datetime.fromisoformat(pair[1]["received_at"]),
                    pair[1]["id"],
                    pair[0],
                ),
            )
            items.append(MailSummary(**item))
            state["accounts"][key]["items"].pop(0)
        # Failed mailboxes can be retried through a fresh list request.
        state["accounts"] = {
            key: queue for key, queue in state["accounts"].items() if key not in failed
        }
        more = any(queue["items"] or not queue["done"] for queue in state["accounts"].values())
        next_cursor = None
        if more:
            next_cursor = secrets.token_urlsafe(32)
            db.execute(delete(MailPage).where(MailPage.expires_at <= int(time.time())))
            db.add(
                MailPage(
                    id=next_cursor,
                    user_id=user_id,
                    encrypted_state=self.vault.encrypt(json.dumps(state)),
                    expires_at=int(time.time()) + 1200,
                )
            )
            db.commit()
        labels = mail_categories.lookup(
            db, user_id, [(item.connection_id, item.id) for item in items]
        )
        for item in items:
            label = labels.get((item.connection_id, item.id))
            if label:
                item.category, item.category_status = label["category"], label["status"]
        return MailList(items=items, next_cursor=next_cursor, issues=issues)

    def message(self, db: Session, user_id: str, connection_id: str, message_id: str):
        row, token = self.access(db, user_id, connection_id)
        try:
            if row.provider == netease.PROVIDER:
                return self.netease.message(token, message_id, row.id, row.email_address)
            return detail(
                self.google.message(token, message_id, full=True), row.id, row.email_address
            )
        except AuthError as exc:
            if exc.code == "MAIL_REAUTHORIZE":
                self.reauthorize(db, user_id, connection_id)
            raise
        except (ValueError, KeyError, TypeError):
            raise AuthError(
                "MAIL_CONTENT_UNAVAILABLE", "这封邮件暂时无法解析，请稍后重试。", 502
            ) from None
