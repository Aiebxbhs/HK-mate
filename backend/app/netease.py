"""NetEase mail (163 / 126 / yeah.net) over IMAP, read-only.

The authorization code and server replies never reach logs or error messages. The inbox is
opened with EXAMINE and only SEARCH / FETCH with BODY.PEEK are sent, so nothing is marked read,
moved or deleted.
"""

import email
import email.policy
import imaplib
import json
import re
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

from app.gmail import PlainHTML
from app.mail_schemas import MailDetail, MailSummary
from app.services import AuthError

PROVIDER = "netease"
HOSTS = {"163.com": "imap.163.com", "126.com": "imap.126.com", "yeah.net": "imap.yeah.net"}
ADDRESS = r"^[A-Za-z0-9._-]{1,64}@(163\.com|126\.com|yeah\.net)$"
PAGE_SIZE = 20
# Enough for the headers and the start of the text of almost every mail.
PREVIEW_BYTES = 8_000
FULL_BYTES = 2_000_000
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def credentials(address: str, code: str) -> str:
    return json.dumps({"address": address, "code": code})


def message_id(validity: int, uid: int) -> str:
    """UIDs are only stable within one UIDVALIDITY, so both go into the id."""
    return f"v{validity}-{uid}"


def imap_date(timestamp: float) -> str:
    day = datetime.fromtimestamp(timestamp, UTC) - timedelta(days=1)  # server-local dates
    return f"{day.day:02d}-{MONTHS[day.month - 1]}-{day.year}"


def unavailable() -> AuthError:
    return AuthError("MAIL_PROVIDER_UNAVAILABLE", "暂时无法读取网易邮箱，请稍后重试。", 502)


def parse_fetch(data: list) -> list[tuple[int, bool, int, bytes]]:
    """(uid, unread, received_at, raw bytes) for each message of a FETCH response."""
    found = []
    for index, item in enumerate(data or []):
        if not isinstance(item, tuple) or len(item) < 2:
            continue
        meta = item[0]
        # Servers may put FLAGS / UID after the literal, in the following line.
        if index + 1 < len(data) and isinstance(data[index + 1], bytes):
            meta += b" " + data[index + 1]
        uid = re.search(rb"UID (\d+)", meta)
        date = re.search(rb'INTERNALDATE "[^"]+"', meta)
        flags = re.search(rb"FLAGS \(([^)]*)\)", meta)
        parsed = imaplib.Internaldate2tuple(date.group(0)) if date else None
        if not uid or not parsed:
            continue
        found.append(
            (
                int(uid.group(1)),
                b"\\Seen" not in (flags.group(1) if flags else b""),
                int(time.mktime(parsed)),
                item[1],
            )
        )
    return found


def header(message: EmailMessage, name: str, default: str = "") -> str:
    try:
        value = message.get(name)
        return " ".join(str(value).split()) if value else default
    except Exception:
        return default  # A malformed header must not hide the whole mail.


def contents(message: EmailMessage) -> tuple[str, list[str]]:
    """Plain text of a mail (HTML converted) and the names of its attachments."""
    plain, html, attachments = [], [], []
    for part in message.walk():
        if part.is_multipart():
            continue
        try:
            filename = part.get_filename()
            if filename:
                attachments.append(str(filename))
                continue
            kind = part.get_content_type()
            if kind in ("text/plain", "text/html"):
                (plain if kind == "text/plain" else html).append(str(part.get_content()))
        except Exception:
            continue  # Unknown charset or a part cut off by the size limit.
    if not plain and html:
        parser = PlainHTML()
        parser.feed("\n".join(html))
        plain = ["".join(parser.text)]
    return "\n".join(plain), attachments


def summarize(
    item: tuple[int, bool, int, bytes], validity: int, connection_id: str, mailbox: str
) -> tuple[MailSummary, EmailMessage]:
    uid, unread, received, raw = item
    message = email.message_from_bytes(raw, policy=email.policy.default)
    text, _ = contents(message)
    return (
        MailSummary(
            id=message_id(validity, uid),
            connection_id=connection_id,
            mailbox=mailbox,
            subject=header(message, "subject", "（无主题）"),
            sender=header(message, "from", "（未知发件人）"),
            received_at=datetime.fromtimestamp(received, UTC),
            snippet=" ".join(text.split())[:200],
            unread=unread,
        ),
        message,
    )


class NeteaseMailbox:
    def __init__(self, imap=imaplib.IMAP4_SSL):
        self.imap = imap

    @contextmanager
    def inbox(self, token: str) -> Iterator[tuple[imaplib.IMAP4, int]]:
        """A signed-in connection with the inbox open read-only, and its UIDVALIDITY."""
        try:
            saved = json.loads(token)
            address, code = saved["address"], saved["code"]
            host = HOSTS[address.rsplit("@", 1)[1]]
        except (ValueError, KeyError, TypeError, IndexError, AttributeError):
            raise AuthError("MAIL_REAUTHORIZE", "邮箱授权无效，请重新连接。", 401) from None
        try:
            connection = self.imap(host, 993, timeout=12)
        except (OSError, imaplib.IMAP4.error):
            raise unavailable() from None
        try:
            try:
                connection.login(address, code)
            except imaplib.IMAP4.error:
                raise AuthError(
                    "MAIL_REAUTHORIZE", "网易邮箱授权码无效或已失效，请重新连接。", 401
                ) from None
            try:
                # NetEase refuses to open folders ("Unsafe Login") until the client names itself.
                connection.xatom("ID", '("name" "HKMate" "version" "1.0" "vendor" "HKMate")')
            except imaplib.IMAP4.error:
                pass
            status, _ = connection.select("INBOX", readonly=True)
            if status != "OK":
                raise AuthError(
                    "MAIL_PROVIDER_LIMITED",
                    "网易邮箱拒绝了本次访问，请确认已在网页版开启 IMAP 服务后重试。",
                    503,
                )
            validity = int(connection.response("UIDVALIDITY")[1][0])
            yield connection, validity
        except AuthError:
            raise
        except (OSError, imaplib.IMAP4.error, ValueError, TypeError, IndexError):
            raise unavailable() from None
        finally:
            try:
                connection.logout()
            except Exception:
                pass

    @staticmethod
    def search(connection, *criteria: str) -> list[int]:
        status, data = connection.uid("SEARCH", None, *criteria)
        if status != "OK":
            raise ValueError()
        return sorted(int(uid) for uid in (data[0] or b"").split())

    @staticmethod
    def fetch(connection, uids: list[int], size: int) -> list[tuple[int, bool, int, bytes]]:
        if not uids:
            return []
        status, data = connection.uid(
            "FETCH", ",".join(map(str, uids)), f"(UID FLAGS INTERNALDATE BODY.PEEK[]<0.{size}>)"
        )
        if status != "OK":
            raise ValueError()
        return parse_fetch(data)

    def verify(self, token: str) -> None:
        with self.inbox(token):
            pass

    def page(
        self, token: str, cursor: str | None, connection_id: str, mailbox: str
    ) -> tuple[list[MailSummary], str | None]:
        """Newest inbox mail first; the cursor is the lowest UID already listed."""
        with self.inbox(token) as (connection, validity):
            uids = self.search(connection, "ALL")
            if cursor:
                uids = [uid for uid in uids if uid < int(cursor)]
            chosen = uids[-PAGE_SIZE:]
            items = [
                summarize(item, validity, connection_id, mailbox)[0]
                for item in self.fetch(connection, chosen, PREVIEW_BYTES)
            ]
        items.sort(key=lambda item: (item.received_at, item.id), reverse=True)
        return items, str(chosen[0]) if len(uids) > len(chosen) else None

    def message(self, token: str, id: str, connection_id: str, mailbox: str) -> MailDetail:
        match = re.fullmatch(r"v(\d+)-(\d+)", id)
        missing = AuthError("MAIL_NOT_FOUND", "邮件不存在或已从邮箱移除。", 404)
        if not match:
            raise missing
        with self.inbox(token) as (connection, validity):
            if validity != int(match.group(1)):
                raise missing
            found = self.fetch(connection, [int(match.group(2))], FULL_BYTES)
        if not found:
            raise missing
        overview, message = summarize(found[0], int(match.group(1)), connection_id, mailbox)
        text, attachments = contents(message)
        return MailDetail(
            **overview.model_dump(),
            recipients=header(message, "to"),
            body=text[:200_000] or "（暂无可显示的正文）",
            attachments=attachments,
        )

    def new_mail(
        self,
        token: str,
        connection_id: str,
        mailbox: str,
        validity: int | None,
        last_uid: int,
        after: int,
    ) -> tuple[int, int, list[MailSummary]]:
        """Mail that arrived since the saved position: (UIDVALIDITY, highest UID, new mail).

        With no position yet, or after the server renumbered the folder, mail received after
        `after` is returned instead, so older mail is never announced as new.
        """
        with self.inbox(token) as (connection, current):
            if validity == current:
                uids = [uid for uid in self.search(connection, "UID", f"{last_uid + 1}:*")]
                uids = [uid for uid in uids if uid > last_uid]
                top = max([last_uid, *uids])
                fetched = self.fetch(connection, uids[-100:], PREVIEW_BYTES)
            else:
                everything = self.search(connection, "ALL")
                top = everything[-1] if everything else 0
                recent = self.search(connection, "SINCE", imap_date(after))
                fetched = [
                    item
                    for item in self.fetch(connection, recent[-100:], PREVIEW_BYTES)
                    if item[2] > after
                ]
        return (
            current,
            top,
            [summarize(item, current, connection_id, mailbox)[0] for item in fetched],
        )

    def recent_ids(self, token: str, days: int) -> list[str]:
        """Ids of the inbox mail of the last days, newest first."""
        with self.inbox(token) as (connection, validity):
            uids = self.search(connection, "SINCE", imap_date(time.time() - days * 86400))
        return [message_id(validity, uid) for uid in reversed(uids[-300:])]
