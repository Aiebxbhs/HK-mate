import base64
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from app.core.config import Settings
from app.gmail import GoogleMailbox, TokenVault, detail
from app.models import EmailConnection, MailOAuthState, MailPage
from app.services import AuthError
from sqlalchemy import select
from test_auth import login, post, register


@pytest.fixture
def mailbox(client, tmp_path, monkeypatch):
    config = tmp_path / "google.json"
    config.write_text(
        json.dumps(
            {
                "web": {
                    "client_id": "synthetic-client",
                    "client_secret": "synthetic-secret",
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [client.app.state.settings.google_redirect_uri],
                }
            }
        )
    )
    client.app.state.settings.google_client_file = config
    client.app.state.settings.token_key_file = tmp_path / "mail.key"
    client.app.state.mail.vault = TokenVault(client.app.state.settings)
    register(client)
    login(client)
    google = client.app.state.mail.google
    monkeypatch.setattr(
        google,
        "exchange",
        lambda code, verifier: json.dumps(
            {"refresh_token": "synthetic-refresh", "token": "synthetic-access"}
        ),
    )
    monkeypatch.setattr(google, "refresh", lambda value: ("synthetic-access", value))
    monkeypatch.setattr(google, "profile", lambda token: "first@example.com")
    return client


def connect(client):
    response = post(client, "/api/v1/email-connections/google/authorize")
    assert response.status_code == 200, response.text
    url = response.json()["authorization_url"]
    query = parse_qs(urlparse(url).query)
    assert query["scope"] == ["https://www.googleapis.com/auth/gmail.readonly"]
    assert query["code_challenge_method"] == ["S256"]
    assert "synthetic-secret" not in url
    response = client.get(
        "/api/v1/email-connections/google/callback",
        params={"state": query["state"][0], "code": "synthetic-code"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers["location"].endswith("?gmail=connected")
    return query["state"][0]


def synthetic_message(id, timestamp, subject="Synthetic subject"):
    return {
        "id": id,
        "internalDate": str(timestamp),
        "labelIds": ["INBOX", "UNREAD"],
        "snippet": "Synthetic preview",
        "payload": {
            "mimeType": "text/plain",
            "headers": [
                {"name": "Subject", "value": subject},
                {"name": "From", "value": "sender@example.com"},
                {"name": "To", "value": "first@example.com"},
            ],
            "body": {"data": base64.urlsafe_b64encode(b"Synthetic plain text").decode()},
        },
    }


def test_live_summary_endpoint_checks_ownership_csrf_and_releases_model_lock(mailbox, monkeypatch):
    from app.mail_summary import EmailSummary, SummaryError, SummaryPoint, SummaryResult

    connect(mailbox)
    cid = mailbox.get("/api/v1/email-connections").json()["items"][0]["id"]
    path = f"/api/v1/email-connections/{cid}/messages/synthetic-summary/summary"
    monkeypatch.setattr(
        mailbox.app.state.mail.google,
        "message",
        lambda token, id, full=False: synthetic_message(id, 1000000),
    )
    calls = []

    def summarize(mail):
        calls.append(mail.id)
        return SummaryResult(
            EmailSummary(
                overview="课程团队通知您参加讨论。",
                key_points=[
                    SummaryPoint(text="课程通知", evidence="Synthetic"),
                    SummaryPoint(text="讨论安排", evidence="plain text"),
                ],
                actions=[],
                needs_reply=None,
                uncertainties=[],
            ),
            1.0,
            False,
            30,
        )

    monkeypatch.setattr(mailbox.app.state.summarizer, "summarize", summarize)
    assert mailbox.post(path).status_code == 403
    assert post(mailbox, path).json()["summary"]["overview"] == "课程团队通知您参加讨论。"
    assert calls == ["synthetic-summary"]
    assert not mailbox.app.state.summary_lock.locked()
    mailbox.app.state.summary_lock.acquire()
    try:
        assert post(mailbox, path).json()["error"]["code"] == "SUMMARY_BUSY"
    finally:
        mailbox.app.state.summary_lock.release()

    def timeout(mail):
        raise SummaryError("SUMMARY_TIMEOUT")

    monkeypatch.setattr(mailbox.app.state.summarizer, "summarize", timeout)
    assert post(mailbox, path).json()["error"]["code"] == "SUMMARY_TIMEOUT"
    assert not mailbox.app.state.summary_lock.locked()
    register(mailbox, "summary_other_user")
    login(mailbox, "summary_other_user")
    assert post(mailbox, path).status_code == 404
    post(mailbox, "/api/v1/auth/logout")
    assert post(mailbox, path).status_code == 401
    assert calls == ["synthetic-summary"]


def test_oauth_state_encryption_replay_and_listing(mailbox):
    state = connect(mailbox)
    response = mailbox.get("/api/v1/email-connections")
    assert response.json()["google_configured"] is True
    row = response.json()["items"][0]
    assert set(row) == {"id", "provider", "email_address", "status", "created_at"}
    assert row["email_address"] == "first@example.com"
    with mailbox.app.state.session_factory() as db:
        encrypted = db.scalar(select(EmailConnection)).encrypted_credentials
        assert "synthetic-refresh" not in encrypted and "synthetic-access" not in encrypted
        assert not list(db.scalars(select(MailOAuthState)))
    replay = mailbox.get(
        "/api/v1/email-connections/google/callback",
        params={"state": state, "code": "again"},
        follow_redirects=False,
    )
    assert replay.headers["location"].endswith("?gmail=expired")


def test_wrong_session_expired_and_cancelled_oauth(mailbox):
    url = post(mailbox, "/api/v1/email-connections/google/authorize").json()["authorization_url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    login(mailbox)  # Rotates the login session; old authorization must fail.
    assert (
        mailbox.get(
            "/api/v1/email-connections/google/callback",
            params={"state": state, "code": "test"},
            follow_redirects=False,
        )
        .headers["location"]
        .endswith("expired")
    )
    url = post(mailbox, "/api/v1/email-connections/google/authorize").json()["authorization_url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    assert (
        mailbox.get(
            "/api/v1/email-connections/google/callback",
            params={"state": state, "error": "access_denied"},
            follow_redirects=False,
        )
        .headers["location"]
        .endswith("cancelled")
    )
    with mailbox.app.state.session_factory() as db:
        assert db.scalar(select(EmailConnection)) is None


def test_cross_user_cannot_read_disconnect_or_use_cursor(mailbox, monkeypatch):
    connect(mailbox)
    cid = mailbox.get("/api/v1/email-connections").json()["items"][0]["id"]
    vault = mailbox.app.state.mail.vault
    with mailbox.app.state.session_factory() as db:
        owner = db.scalar(select(EmailConnection)).user_id
        db.add(
            MailPage(
                id="private-cursor",
                user_id=owner,
                encrypted_state=vault.encrypt("{}"),
                expires_at=int(time.time()) + 600,
            )
        )
        db.commit()
    register(mailbox, "another_user")
    login(mailbox, "another_user")
    assert mailbox.get("/api/v1/email-connections").json()["items"] == []
    assert mailbox.get(f"/api/v1/email-connections/{cid}/messages/test").status_code == 404
    assert mailbox.get("/api/v1/messages", params={"connection_id": cid}).status_code == 404
    assert mailbox.get("/api/v1/messages", params={"cursor": "private-cursor"}).status_code == 410
    token = mailbox.get("/api/v1/auth/csrf").json()["csrf_token"]
    response = mailbox.delete(
        f"/api/v1/email-connections/{cid}",
        headers={"Origin": "http://testserver", "X-CSRF-Token": token},
    )
    assert response.status_code == 404


def test_unified_pagination_is_sorted_without_duplicates(mailbox, monkeypatch):
    connect(mailbox)
    google = mailbox.app.state.mail.google
    monkeypatch.setattr(google, "profile", lambda token: "second@example.com")
    connect(mailbox)
    # Every mailbox has multiple pages. Interleave timestamps to exercise buffered merge.
    count = 0

    def page(token, cursor, scope):
        nonlocal count
        count += 1
        start = 0 if cursor is None else int(cursor)
        stop = min(start + 20, 25)
        return {
            "messages": [{"id": f"m{i}"} for i in range(start, stop)],
            **({"nextPageToken": str(stop)} if stop < 25 else {}),
        }

    monkeypatch.setattr(google, "page", page)
    monkeypatch.setattr(
        google,
        "message",
        lambda token, id, full=False: synthetic_message(id, 1_700_000_000_000 - int(id[1:]) * 1000),
    )
    items, cursor = [], None
    while True:
        result = mailbox.get("/api/v1/messages", params={"cursor": cursor} if cursor else {})
        assert result.status_code == 200, result.text
        data = result.json()
        items.extend(data["items"])
        cursor = data["next_cursor"]
        if not cursor:
            break
    assert len(items) == 50
    assert len({(item["connection_id"], item["id"]) for item in items}) == 50
    assert [item["received_at"] for item in items] == sorted(
        [item["received_at"] for item in items], reverse=True
    )
    assert count == 4
    with mailbox.app.state.session_factory() as db:
        assert all(
            "Synthetic preview" not in value
            for value in db.scalars(select(MailPage.encrypted_state))
        )


def test_html_is_text_and_attachments_are_not_fetched():
    message = synthetic_message("html", 1_700_000_000_000)
    message["payload"]["mimeType"] = "multipart/mixed"
    message["payload"]["body"] = {}
    message["payload"]["parts"] = [
        {
            "mimeType": "text/html",
            "body": {
                "data": base64.urlsafe_b64encode(
                    b'<script>bad()</script><p>Hello<img src="https://tracking.invalid/a"></p>'
                ).decode()
            },
        },
        {"filename": "file.pdf", "body": {"attachmentId": "not-downloaded"}},
    ]
    result = detail(message, "mailbox", "test@example.com")
    assert "Hello" in result.body
    assert "bad()" not in result.body and "<img" not in result.body
    assert result.attachments == ["file.pdf"]


def test_auth_failure_isolated_and_revocation_retry(mailbox, monkeypatch):
    connect(mailbox)
    cid = mailbox.get("/api/v1/email-connections").json()["items"][0]["id"]

    def fail(_):
        raise AuthError("MAIL_REAUTHORIZE", "请重新授权", 401)

    monkeypatch.setattr(mailbox.app.state.mail.google, "refresh", fail)
    response = mailbox.get("/api/v1/messages").json()
    assert response["items"] == [] and response["issues"]
    assert (
        mailbox.get("/api/v1/email-connections").json()["items"][0]["status"]
        == "reauthorization_required"
    )
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: httpx.Response(503))
    csrf = mailbox.get("/api/v1/auth/csrf").json()["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    assert mailbox.delete(f"/api/v1/email-connections/{cid}", headers=headers).status_code == 502
    assert (
        mailbox.get("/api/v1/email-connections").json()["items"][0]["status"]
        == "revocation_pending"
    )
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: httpx.Response(200))
    assert mailbox.delete(f"/api/v1/email-connections/{cid}", headers=headers).status_code == 204
    assert mailbox.get("/api/v1/email-connections").json()["items"] == []


def test_unconfigured_google_and_missing_key_fail_closed(tmp_path):
    settings = Settings(
        google_client_file=tmp_path / "missing.json", token_key_file=tmp_path / "missing.key"
    )
    assert not GoogleMailbox(settings).configured()
    with pytest.raises(AuthError):
        TokenVault(settings).decrypt("anything")
    assert not settings.token_key_file.exists()


def test_reply_draft_endpoint_checks_ownership_csrf_input_and_model_lock(mailbox, monkeypatch):
    from app.mail_reply import DraftError, ReplyDraft

    connect(mailbox)
    cid = mailbox.get("/api/v1/email-connections").json()["items"][0]["id"]
    path = f"/api/v1/email-connections/{cid}/messages/synthetic-reply/reply-draft"
    monkeypatch.setattr(
        mailbox.app.state.mail.google,
        "message",
        lambda token, id, full=False: synthetic_message(id, 1000000, subject="Meeting"),
    )
    calls = []

    def draft(mail, ask):
        calls.append((mail.id, ask.intent, ask.note, ask.signature))
        return ReplyDraft("Hi,\n\nSure.\n\nSam", [], "sender@example.com", "", "Re: Meeting", 1.0)

    monkeypatch.setattr(mailbox.app.state.reply_drafter, "draft", draft)
    body = {"intent": "accept", "signature": " Sam "}
    assert mailbox.post(path, json=body).status_code == 403
    result = post(mailbox, path, body).json()
    assert result["body"] == "Hi,\n\nSure.\n\nSam"
    assert result["subject"] == "Re: Meeting"
    assert result["to_address"] == "sender@example.com"
    assert result["mailbox"]
    assert calls == [("synthetic-reply", "accept", "", "Sam")]
    assert not mailbox.app.state.summary_lock.locked()

    assert post(mailbox, path, {"intent": "custom", "note": "  "}).status_code == 400
    assert post(mailbox, path, {"intent": "send_now"}).status_code == 422
    assert post(mailbox, path, {"intent": "accept", "note": "x" * 501}).status_code == 422
    assert post(mailbox, path, {"intent": "accept", "to": "x@example.com"}).status_code == 422

    mailbox.app.state.summary_lock.acquire()
    try:
        assert post(mailbox, path, body).json()["error"]["code"] == "SUMMARY_BUSY"
    finally:
        mailbox.app.state.summary_lock.release()

    def timeout(mail, ask):
        raise DraftError("REPLY_TIMEOUT")

    monkeypatch.setattr(mailbox.app.state.reply_drafter, "draft", timeout)
    response = post(mailbox, path, body)
    assert response.status_code == 503 and response.json()["error"]["code"] == "REPLY_TIMEOUT"
    assert not mailbox.app.state.summary_lock.locked()

    register(mailbox, "reply_other_user")
    login(mailbox, "reply_other_user")
    assert post(mailbox, path, body).status_code == 404
    post(mailbox, "/api/v1/auth/logout")
    assert post(mailbox, path, body).status_code == 401
    assert len(calls) == 1
