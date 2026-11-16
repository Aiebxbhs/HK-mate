"""163 mailbox over IMAP, against a synthetic in-memory server. No real mailbox is contacted."""

import imaplib
import json
import time
from email.message import EmailMessage

import pytest
from app.gmail import TokenVault
from app.mail_summary import EmailSummary, SummaryPoint, SummaryResult
from app.models import EmailConnection, MailNotification
from sqlalchemy import select
from test_auth import ORIGIN, login, post, register

ADDRESS = "synthetic@163.com"
CODE = "SYNTHETICCODE1234"


def raw_mail(subject: str, body: str = "合成正文 Synthetic body", html: bool = False) -> bytes:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = "课程团队 <team@example.com>"
    message["To"] = ADDRESS
    if html:
        message.set_content("<p>只是文字</p><script>track()</script>", subtype="html")
        message.add_attachment(b"data", maintype="application", subtype="pdf", filename="a.pdf")
    else:
        message.set_content(body, charset="gb2312")
    return message.as_bytes()


class FakeServer:
    """Mailbox state shared by every connection the code under test opens."""

    def __init__(self):
        self.validity = 7
        self.mail: dict[int, tuple[float, bool, bytes]] = {}
        self.commands: list[tuple] = []
        self.logins = 0
        self.accept_code = CODE
        self.imap_enabled = True
        self.down = False

    def add(self, uid: int, subject: str, age: float = 1, seen: bool = False, **kwargs) -> None:
        self.mail[uid] = (time.time() - age, seen, raw_mail(subject, **kwargs))

    def connect(self, host, port, timeout=None):
        if self.down:
            raise OSError("synthetic network failure")
        assert (host, port) == ("imap.163.com", 993)
        return FakeConnection(self)


class FakeConnection:
    def __init__(self, server: FakeServer):
        self.server, self.identified = server, False

    def login(self, address, code):
        self.server.logins += 1
        if address != ADDRESS or code != self.server.accept_code:
            raise imaplib.IMAP4.error("LOGIN failed: synthetic server text")

    def xatom(self, name, *args):
        self.server.commands.append((name, *args))
        self.identified = True
        return "OK", [b""]

    def select(self, folder, readonly=False):
        self.server.commands.append(("SELECT", folder, readonly))
        if not self.identified or not self.server.imap_enabled:
            return "NO", [b"Unsafe Login"]
        return "OK", [b"1"]

    def response(self, code):
        return code, [str(self.server.validity).encode()]

    def uid(self, command, *args):
        self.server.commands.append((command, *args))
        uids = sorted(self.server.mail)
        if command == "SEARCH":
            criteria = [arg for arg in args if arg is not None]
            if criteria[0] == "UID":
                low = int(criteria[1].split(":")[0])
                # Real servers always include the highest UID for "n:*".
                uids = [uid for uid in uids if uid >= low] or uids[-1:]
            elif criteria[0] == "SINCE":
                assert len(criteria[1].split("-")) == 3
            return "OK", [" ".join(map(str, uids)).encode()]
        if command == "FETCH":
            assert "BODY.PEEK[]" in args[1]
            data = []
            for uid in map(int, args[0].split(",")):
                if uid not in self.server.mail:
                    continue
                received, seen, raw = self.server.mail[uid]
                date = imaplib.Time2Internaldate(received)
                data.append((f"1 (UID {uid} INTERNALDATE {date} BODY[]<0> {{9}}".encode(), raw))
                data.append(b" FLAGS (\\Seen))" if seen else b" FLAGS ())")
            return "OK", data
        raise AssertionError(f"Unexpected write or unknown command: {command}")

    def logout(self):
        return "BYE", []


@pytest.fixture
def netease(client, tmp_path, monkeypatch):
    settings = client.app.state.settings
    settings.token_key_file = tmp_path / "mail-token.key"
    settings.google_client_file = tmp_path / "missing.json"
    client.app.state.mail.vault = TokenVault(settings)
    server = FakeServer()
    client.app.state.mail.netease.imap = server.connect
    register(client)
    login(client)
    return client, server


def link(client, address=ADDRESS, code=CODE):
    return post(
        client,
        "/api/v1/email-connections/netease",
        {"email_address": address, "authorization_code": code},
    )


def test_connect_requires_login_csrf_valid_input_and_a_working_code(netease):
    client, server = netease
    body = {"email_address": ADDRESS, "authorization_code": CODE}
    assert client.post("/api/v1/email-connections/netease", json=body).status_code == 403
    assert link(client, address="someone@example.com").status_code == 422
    wrong = link(client, code="WRONGCODE1234567")
    assert wrong.status_code == 401
    assert "synthetic server text" not in wrong.text and "WRONGCODE" not in wrong.text
    server.imap_enabled = False
    assert link(client).json()["error"]["code"] == "MAIL_PROVIDER_LIMITED"
    server.imap_enabled, server.down = True, True
    assert link(client).status_code == 502
    server.down = False
    assert client.get("/api/v1/email-connections").json()["items"] == []

    created = link(client)
    assert created.status_code == 201
    assert created.json()["provider"] == "netease" and CODE not in created.text
    # The client names itself before opening the inbox, and opens it read-only.
    assert ("SELECT", "INBOX", True) in server.commands
    assert server.commands[server.commands.index(("SELECT", "INBOX", True)) - 1][0] == "ID"
    with client.app.state.session_factory() as db:
        row = db.scalar(select(EmailConnection))
        assert CODE not in row.encrypted_credentials
        saved = json.loads(client.app.state.mail.vault.decrypt(row.encrypted_credentials))
        assert saved == {"address": ADDRESS, "code": CODE}
    # Linking again updates the same row instead of adding a second one.
    assert link(client).status_code == 201
    assert len(client.get("/api/v1/email-connections").json()["items"]) == 1

    client.cookies.clear()
    assert client.post("/api/v1/email-connections/netease", json=body).status_code in (401, 403)
    register(client, "student_02")
    login(client, "student_02")
    assert link(client).json()["error"]["code"] == "MAILBOX_ALREADY_LINKED"


def test_lists_pages_reads_and_never_writes(netease):
    client, server = netease
    for uid in range(1, 26):
        server.add(uid, f"合成主题 {uid}", age=1000 - uid, seen=uid % 2 == 0)
    server.add(26, "HTML 邮件", age=0, html=True)
    assert link(client).status_code == 201
    cid = client.get("/api/v1/email-connections").json()["items"][0]["id"]

    first = client.get("/api/v1/messages").json()
    assert [item["subject"] for item in first["items"][:2]] == ["HTML 邮件", "合成主题 25"]
    assert len(first["items"]) == 20 and first["next_cursor"]
    assert first["items"][1]["sender"].startswith("课程团队")
    assert first["items"][1]["snippet"] == "合成正文 Synthetic body"
    assert first["items"][1]["unread"] is True and first["items"][2]["unread"] is False
    second = client.get("/api/v1/messages", params={"cursor": first["next_cursor"]}).json()
    assert len(second["items"]) == 6 and second["next_cursor"] is None
    ids = [item["id"] for item in first["items"] + second["items"]]
    assert len(set(ids)) == 26 and ids[0] == "v7-26"

    detail = client.get(f"/api/v1/email-connections/{cid}/messages/v7-26").json()
    assert "只是文字" in detail["body"] and "track()" not in detail["body"]
    assert detail["attachments"] == ["a.pdf"] and detail["recipients"] == ADDRESS
    # Unknown UID, and a UID from before the folder was renumbered, are both "not found".
    assert client.get(f"/api/v1/email-connections/{cid}/messages/v7-99").status_code == 404
    assert client.get(f"/api/v1/email-connections/{cid}/messages/v6-26").status_code == 404
    assert {command[0] for command in server.commands} <= {"ID", "SELECT", "SEARCH", "FETCH"}

    # Another account can neither read nor unlink this mailbox.
    client.cookies.clear()
    register(client, "student_02")
    login(client, "student_02")
    assert client.get(f"/api/v1/email-connections/{cid}/messages/v7-26").status_code == 404
    assert client.delete(
        f"/api/v1/email-connections/{cid}", headers={"Origin": ORIGIN}
    ).status_code in (403, 404)
    assert client.get("/api/v1/messages").json()["items"] == []


def test_refused_code_asks_for_reconnection_and_unlink_removes_the_code(netease):
    client, server = netease
    server.add(1, "合成主题")
    assert link(client).status_code == 201
    cid = client.get("/api/v1/email-connections").json()["items"][0]["id"]
    server.accept_code = "NEWCODE123456789"
    listing = client.get("/api/v1/messages").json()
    assert listing["items"] == [] and "授权码" in listing["issues"][0]["message"]
    connection = client.get("/api/v1/email-connections").json()["items"][0]
    assert connection["status"] == "reauthorization_required"
    logins = server.logins
    assert client.get("/api/v1/messages").json()["items"] == []
    assert server.logins == logins  # No further sign-ins with the refused code.
    assert link(client, code="NEWCODE123456789").status_code == 201
    assert len(client.get("/api/v1/messages").json()["items"]) == 1

    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
    assert client.delete(f"/api/v1/email-connections/{cid}", headers=headers).status_code == 204
    with client.app.state.session_factory() as db:
        assert db.scalar(select(EmailConnection)) is None


def test_monitor_announces_only_new_mail_once_and_survives_renumbering(netease, monkeypatch):
    client, server = netease
    server.add(1, "两小时前的旧邮件", age=7200)
    server.add(2, "刚到的邮件", age=30)
    assert link(client).status_code == 201
    monitor = client.app.state.monitor

    def summarize(mail, language="zh"):
        assert mail.body.strip() == "合成正文 Synthetic body"
        return SummaryResult(
            EmailSummary(
                overview="课程团队发布了作业，请您核对提交要求。",
                category="学校邮件",
                key_points=[
                    SummaryPoint(text="发布作业", evidence="Synthetic"),
                    SummaryPoint(text="提交要求", evidence="body"),
                ],
                actions=[],
                needs_reply=None,
                uncertainties=[],
            ),
            1,
            False,
            20,
        )

    monkeypatch.setattr(client.app.state.summarizer, "summarize", summarize)

    def subjects():
        return sorted(
            row["subject"] for row in client.get("/api/v1/mail-notifications").json()["items"]
        )

    monitor.poll_once()
    assert subjects() == ["刚到的邮件"]
    logins = server.logins
    monitor.poll_once()
    assert server.logins == logins  # Checked at most once a minute.

    server.add(3, "第三封")
    monitor.imap_checked.clear()
    monitor.poll_once()
    monitor.imap_checked.clear()
    monitor.poll_once()
    assert subjects() == ["刚到的邮件", "第三封"]
    while monitor.process_one():
        pass
    rows = client.get("/api/v1/mail-notifications").json()["items"]
    assert all(row["status"] == "ready" for row in rows)
    with client.app.state.session_factory() as db:
        for row in db.scalars(select(MailNotification)):
            assert "刚到的邮件" not in row.encrypted_payload

    # The server renumbers the folder: old mail is not announced again, new mail still is.
    server.validity = 8
    # Received after the last completed check (the synthetic clock runs a few seconds on).
    server.add(4, "重新编号后的新邮件", age=-5)
    monitor.imap_checked.clear()
    monitor.poll_once()
    assert subjects() == ["刚到的邮件", "第三封", "重新编号后的新邮件"]

    # A refused code stops the background sign-ins until the user reconnects.
    server.accept_code = "NEWCODE123456789"
    monitor.imap_checked.clear()
    monitor.poll_once()
    logins = server.logins
    monitor.imap_checked.clear()
    monitor.poll_once()
    assert server.logins == logins
    assert (
        client.get("/api/v1/email-connections").json()["items"][0]["status"]
        == "reauthorization_required"
    )


def test_backfill_queues_recent_inbox_mail_for_categories(netease):
    from app.models import MailCategoryRecord

    client, server = netease
    server.add(5, "最近的邮件", age=86400)
    assert link(client).status_code == 201
    client.app.state.monitor.queue_backfill()
    with client.app.state.session_factory() as db:
        assert [row.message_id for row in db.scalars(select(MailCategoryRecord))] == ["v7-5"]
