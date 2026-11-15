"""Gmail adapter. OAuth secrets and provider responses never reach error messages."""

import base64
import json
import os
from datetime import UTC, datetime
from html import unescape
from html.parser import HTMLParser
from urllib.parse import quote

import httpx
from cryptography.fernet import Fernet, InvalidToken
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

from app.core.config import Settings
from app.mail_schemas import MailDetail, MailSummary
from app.services import AuthError

SCOPE = "https://www.googleapis.com/auth/gmail.readonly"


class TimedGoogleRequest(GoogleRequest):
    def __call__(self, *args, **kwargs):
        kwargs["timeout"] = 12
        return super().__call__(*args, **kwargs)


class TokenVault:
    def __init__(self, settings: Settings):
        self.path = settings.token_key_file

    def cipher(self, create: bool = False) -> Fernet:
        if create and not self.path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(descriptor, "wb") as handle:
                    handle.write(Fernet.generate_key())
            except FileExistsError:
                pass
        try:
            return Fernet(self.path.read_bytes())
        except (OSError, ValueError):
            raise AuthError(
                "MAIL_KEY_UNAVAILABLE", "邮箱加密密钥不可用，请检查本机配置。", 503
            ) from None

    def encrypt(self, value: str, create: bool = False) -> str:
        return self.cipher(create).encrypt(value.encode()).decode()

    def decrypt(self, value: str) -> str:
        try:
            return self.cipher().decrypt(value.encode()).decode()
        except (InvalidToken, ValueError):
            raise AuthError(
                "MAIL_KEY_UNAVAILABLE", "无法解密邮箱授权，请恢复原加密密钥。", 503
            ) from None


class GoogleMailbox:
    def __init__(self, settings: Settings):
        self.settings = settings

    def client_config(self) -> dict:
        try:
            config = json.loads(self.settings.google_client_file.read_text())
            web = config["web"]
            if not web.get("client_id") or not web.get("client_secret"):
                raise ValueError()
            if self.settings.google_redirect_uri not in web.get("redirect_uris", []):
                raise ValueError()
            if web.get("token_uri") != "https://oauth2.googleapis.com/token":
                raise ValueError()
            if web.get("auth_uri") != "https://accounts.google.com/o/oauth2/auth":
                raise ValueError()
            return config
        except (OSError, ValueError, KeyError, TypeError):
            raise AuthError(
                "GOOGLE_NOT_CONFIGURED", "请配置 Google Web OAuth 凭证及本地回调地址。", 503
            ) from None

    def configured(self) -> bool:
        try:
            self.client_config()
            return True
        except AuthError:
            return False

    def authorization(self, state: str) -> tuple[str, str]:
        flow = Flow.from_client_config(
            self.client_config(),
            [SCOPE],
            redirect_uri=self.settings.google_redirect_uri,
            autogenerate_code_verifier=True,
        )
        url, _ = flow.authorization_url(
            state=state,
            access_type="offline",
            prompt="consent",
            include_granted_scopes="false",
            login_hint=None,
        )
        return url, flow.code_verifier

    def exchange(self, code: str, verifier: str) -> str:
        flow = Flow.from_client_config(
            self.client_config(),
            [SCOPE],
            redirect_uri=self.settings.google_redirect_uri,
            code_verifier=verifier,
        )
        try:
            flow.fetch_token(code=code, timeout=12)
            credentials = flow.credentials
            granted = credentials.granted_scopes or credentials.scopes or []
            if SCOPE not in granted or not credentials.refresh_token:
                raise AuthError(
                    "GOOGLE_PERMISSION_MISSING", "需要完整授予 Gmail 只读权限，请重新连接。", 400
                )
            return credentials.to_json()
        except AuthError:
            raise
        except Exception:
            raise AuthError("GOOGLE_AUTH_FAILED", "Google 授权未完成，请重新连接。", 502) from None

    def refresh(self, serialized: str) -> tuple[str, str]:
        try:
            credentials = Credentials.from_authorized_user_info(json.loads(serialized), [SCOPE])
            if credentials.client_id != self.client_config()["web"]["client_id"]:
                raise AuthError("MAIL_REAUTHORIZE", "Google 客户端已变更，请重新授权邮箱。", 401)
            if not credentials.valid:
                transport = TimedGoogleRequest()
                try:
                    credentials.refresh(transport)
                finally:
                    transport.session.close()
            return credentials.token, credentials.to_json()
        except AuthError:
            raise
        except GoogleAuthError as exc:
            if "invalid_grant" in str(exc):
                raise AuthError(
                    "MAIL_REAUTHORIZE", "邮箱授权已过期或被撤销，请重新连接。", 401
                ) from None
            raise AuthError(
                "MAIL_PROVIDER_UNAVAILABLE", "暂时无法更新邮箱授权，请稍后重试。", 502
            ) from None
        except (ValueError, KeyError):
            raise AuthError("MAIL_REAUTHORIZE", "邮箱授权无效，请重新连接。", 401) from None

    def request(self, token: str, path: str, params: dict | None = None) -> dict:
        try:
            response = httpx.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/" + path,
                headers={"Authorization": f"Bearer {token}"},
                params=params,
                timeout=12,
            )
            if response.status_code == 401:
                raise AuthError("MAIL_REAUTHORIZE", "邮箱授权已失效，请重新连接。", 401)
            if response.status_code in (403, 429):
                raise AuthError(
                    "MAIL_PROVIDER_LIMITED", "Google 暂时限制了访问，请检查权限或稍后重试。", 503
                )
            if response.status_code == 404:
                raise AuthError("MAIL_NOT_FOUND", "邮件不存在或已从 Gmail 移除。", 404)
            if response.status_code != 200:
                raise ValueError()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (httpx.HTTPError, ValueError):
            raise AuthError(
                "MAIL_PROVIDER_UNAVAILABLE", "暂时无法读取 Gmail，请稍后重试。", 502
            ) from None

    def profile(self, token: str) -> str:
        email = self.request(token, "profile").get("emailAddress")
        if not isinstance(email, str) or "@" not in email:
            raise AuthError("GOOGLE_AUTH_FAILED", "无法确认 Google 邮箱身份。", 502)
        return email.lower()

    def page(self, token: str, cursor: str | None, scope: str) -> dict:
        params = {"maxResults": 20, "includeSpamTrash": "false"}
        if scope == "inbox":
            params["labelIds"] = "INBOX"
        else:
            params["q"] = "-in:sent -in:drafts -in:trash"
        if cursor:
            params["pageToken"] = cursor
        return self.request(token, "messages", params)

    def message(self, token: str, message_id: str, full: bool = False) -> dict:
        return self.request(
            token,
            "messages/" + quote(message_id, safe=""),
            {"format": "full" if full else "metadata"},
        )


def summary(message: dict, connection_id: str, email: str) -> MailSummary:
    headers = {
        item["name"].lower(): item.get("value", "")
        for item in message.get("payload", {}).get("headers", [])
    }
    return MailSummary(
        id=message["id"],
        connection_id=connection_id,
        mailbox=email,
        subject=headers.get("subject", "（无主题）"),
        sender=headers.get("from", "（未知发件人）"),
        received_at=datetime.fromtimestamp(int(message["internalDate"]) / 1000, UTC),
        snippet=unescape(message.get("snippet", "")),
        unread="UNREAD" in message.get("labelIds", []),
    )


class PlainHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "head"}:
            self.hidden += 1
        if tag in {"p", "br", "div", "li"}:
            self.text.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "head"}:
            self.hidden = max(0, self.hidden - 1)
        if tag in {"p", "div", "li"}:
            self.text.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.text.append(data)


def detail(message: dict, connection_id: str, email: str) -> MailDetail:
    plain, html, attachments = [], [], []

    def visit(part: dict, depth: int = 0):
        if depth > 30:
            return
        if part.get("filename"):
            attachments.append(part["filename"])
            return
        encoded = part.get("body", {}).get("data", "")
        if encoded:
            try:
                text = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode(
                    "utf-8", errors="replace"
                )
                if part.get("mimeType") == "text/plain":
                    plain.append(text)
                elif part.get("mimeType") == "text/html":
                    html.append(text)
            except ValueError:
                pass
        for child in part.get("parts", []):
            visit(child, depth + 1)

    visit(message.get("payload", {}))
    if not plain and html:
        parser = PlainHTML()
        parser.feed("\n".join(html))
        plain = ["".join(parser.text)]
    headers = {
        h["name"].lower(): h.get("value", "") for h in message.get("payload", {}).get("headers", [])
    }
    return MailDetail(
        **summary(message, connection_id, email).model_dump(),
        recipients=headers.get("to", ""),
        body="\n".join(plain)[:200_000] or "（暂无可显示的正文）",
        attachments=attachments,
    )
