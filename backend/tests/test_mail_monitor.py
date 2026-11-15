import json
import time

import pytest
from app.mail_summary import EmailSummary, SummaryError, SummaryPoint, SummaryResult
from app.models import EmailConnection, MailNotification, MailWatch
from app.services import AuthError
from sqlalchemy import select
from test_auth import login, post, register
from test_mail import connect, synthetic_message
from test_mail import mailbox as mailbox


@pytest.fixture
def monitored(mailbox, monkeypatch):
    connect(mailbox)
    google = mailbox.app.state.mail.google
    provider = {
        "initial": ["new-a", "new-b", "old", "sent"],
        "history": [],
        "calls": [],
        "expired": False,
    }

    def request(token, path, params=None):
        provider["calls"].append((path, params))
        if path == "profile":
            return {"historyId": "100"}
        if path == "messages":
            return {"messages": [{"id": id} for id in provider["initial"]]}
        if path == "history":
            if provider["expired"]:
                provider["expired"] = False
                raise AuthError("MAIL_NOT_FOUND", "Synthetic expired history", 404)
            return {
                "historyId": "101",
                "history": [
                    {"messagesAdded": [{"message": {"id": id}} for id in provider["history"]]}
                ],
            }
        raise AssertionError("Unexpected provider endpoint")

    def message(token, id, full=False):
        timestamp = int(time.time()) - (7200 if id == "old" else 1)
        raw = synthetic_message(id, timestamp * 1000)
        if id == "sent":
            raw["labelIds"] = ["SENT"]
        return raw

    def summarize(mail, language="zh"):
        return SummaryResult(
            EmailSummary(
                overview="课程团队发布了作业，请您核对提交要求。",
                category="学校邮件",
                key_points=[
                    SummaryPoint(text="发布作业", evidence="Synthetic"),
                    SummaryPoint(text="提交要求", evidence="plain text"),
                ],
                actions=[],
                needs_reply=None,
                uncertainties=[],
            ),
            1,
            False,
            20,
        )

    monkeypatch.setattr(google, "request", request)
    monkeypatch.setattr(google, "message", message)
    monkeypatch.setattr(mailbox.app.state.summarizer, "summarize", summarize)
    return mailbox, mailbox.app.state.monitor, provider


def test_detects_new_mail_automatically_deduplicates_and_encrypts_results(monitored):
    client, monitor, provider = monitored
    monitor.poll_once()
    data = client.get("/api/v1/mail-notifications").json()
    assert data["total_count"] == 2
    assert all(row["status"] == "pending" for row in data["items"])
    assert monitor.process_one() and monitor.process_one()
    assert not monitor.process_one()
    data = client.get("/api/v1/mail-notifications").json()
    assert all(
        row["status"] == "ready" and row["summary"]["category"] == "学校邮件"
        for row in data["items"]
    )
    provider["history"] = ["new-a", "new-b", "new-c"]
    monitor.poll_once()
    monitor.poll_once()
    assert client.get("/api/v1/mail-notifications").json()["total_count"] == 3
    assert monitor.process_one()
    with client.app.state.session_factory() as db:
        rows = list(db.scalars(select(MailNotification)))
        assert len(rows) == 3
        for row in rows:
            assert "Synthetic subject" not in row.encrypted_payload
            assert "课程团队" not in row.encrypted_payload
            decrypted = json.loads(client.app.state.mail.vault.decrypt(row.encrypted_payload))
            assert "body" not in decrypted["mail"]
        state = json.loads(
            client.app.state.mail.vault.decrypt(db.scalar(select(MailWatch)).encrypted_state)
        )
        assert state["history_id"] == "101"
    first = data["items"][0]["id"]
    assert client.post(f"/api/v1/mail-notifications/{first}/dismiss").status_code == 403
    assert post(client, f"/api/v1/mail-notifications/{first}/dismiss").status_code == 204
    monitor.poll_once()
    assert client.get("/api/v1/mail-notifications").json()["total_count"] == 2


def test_failures_retry_and_expired_history_recovery(monitored, monkeypatch):
    client, monitor, provider = monitored
    monitor.poll_once()
    original = monitor.summarizer.summarize

    def fail(mail, language="zh"):
        raise SummaryError("SUMMARY_TIMEOUT")

    monkeypatch.setattr(monitor.summarizer, "summarize", fail)
    assert monitor.process_one()
    assert not monitor.model_lock.locked()
    failed = next(
        row
        for row in client.get("/api/v1/mail-notifications").json()["items"]
        if row["status"] == "failed"
    )
    assert "超时" in failed["error"]
    assert post(client, f"/api/v1/mail-notifications/{failed['id']}/retry").status_code == 204
    monkeypatch.setattr(monitor.summarizer, "summarize", original)
    while monitor.process_one():
        pass
    assert all(
        row["status"] == "ready" for row in client.get("/api/v1/mail-notifications").json()["items"]
    )
    provider["expired"] = True
    monitor.poll_once()
    with client.app.state.session_factory() as db:
        state = json.loads(
            client.app.state.mail.vault.decrypt(db.scalar(select(MailWatch)).encrypted_state)
        )
        assert state["phase"] == "bootstrap"
        assert state["after"] >= int(time.time()) - 65
    monitor.poll_once()
    assert client.get("/api/v1/mail-notifications").json()["total_count"] == 2


def test_notification_ownership_auth_and_unbinding_cleanup(monitored):
    client, monitor, _ = monitored
    monitor.poll_once()
    data = client.get("/api/v1/mail-notifications").json()
    item = data["items"][0]
    register(client, "notification_other")
    login(client, "notification_other")
    assert client.get("/api/v1/mail-notifications").json()["items"] == []
    assert client.get(f"/api/v1/mail-notifications?cursor={item['id']}").status_code == 404
    for action in ("dismiss", "retry"):
        assert post(client, f"/api/v1/mail-notifications/{item['id']}/{action}").status_code == 404
    post(client, "/api/v1/auth/logout")
    assert client.get("/api/v1/mail-notifications").status_code == 401
    with client.app.state.session_factory() as db:
        connection = db.get(EmailConnection, item["connection_id"])
        db.delete(connection)
        db.commit()
        assert list(db.scalars(select(MailNotification))) == []
        assert list(db.scalars(select(MailWatch))) == []


def test_notification_pagination_and_restart_recovery(monitored):
    client, monitor, provider = monitored
    provider["initial"] = [f"page-{i}" for i in range(105)]
    monitor.poll_once()
    first = client.get("/api/v1/mail-notifications").json()
    assert first["total_count"] == 105 and len(first["items"]) == 100
    second = client.get(
        "/api/v1/mail-notifications", params={"cursor": first["next_cursor"]}
    ).json()
    assert len(second["items"]) == 5 and second["next_cursor"] is None
    assert not set(item["id"] for item in first["items"]) & set(
        item["id"] for item in second["items"]
    )
    with client.app.state.session_factory() as db:
        row = db.get(MailNotification, first["items"][0]["id"])
        row.status = "processing"
        db.commit()
    monitor.recover_pending()
    assert all(
        item["status"] == "pending"
        for item in client.get("/api/v1/mail-notifications").json()["items"]
    )


def test_history_cursor_advances_only_after_last_page(monitored, monkeypatch):
    client, monitor, provider = monitored
    provider["initial"] = []
    monitor.poll_once()
    original = monitor.mail.google.request

    def paged(token, path, params=None):
        if path != "history":
            return original(token, path, params)
        assert params["startHistoryId"] == "100"
        result = {
            "historyId": "200",
            "history": [
                {
                    "messagesAdded": [
                        {
                            "message": {
                                "id": "next-page" if params.get("pageToken") else "first-page"
                            }
                        }
                    ]
                }
            ],
        }
        if not params.get("pageToken"):
            result["nextPageToken"] = "page-two"
        return result

    monkeypatch.setattr(monitor.mail.google, "request", paged)
    monitor.poll_once()
    with client.app.state.session_factory() as db:
        state = json.loads(
            client.app.state.mail.vault.decrypt(db.scalar(select(MailWatch)).encrypted_state)
        )
        assert state["history_id"] == "100" and state["page_token"] == "page-two"
    monitor.poll_once()
    with client.app.state.session_factory() as db:
        state = json.loads(
            client.app.state.mail.vault.decrypt(db.scalar(select(MailWatch)).encrypted_state)
        )
        assert state["history_id"] == "200" and state["page_token"] is None
    assert client.get("/api/v1/mail-notifications").json()["total_count"] == 2


@pytest.fixture
def labelled(monitored, monkeypatch):
    client, monitor, provider = monitored
    calls = []

    def classify(mail):
        calls.append(mail.id)
        return "广告推广" if mail.id == "old" else "求职邮件"

    monkeypatch.setattr(monitor.summarizer, "classify", classify)
    return client, monitor, provider, calls


def categories(client):
    from app.models import MailCategoryRecord

    with client.app.state.session_factory() as db:
        return {
            row.message_id: (row.category, row.status)
            for row in db.scalars(select(MailCategoryRecord))
        }


def test_backfill_labels_recent_mail_after_new_mail_summaries(labelled):
    client, monitor, provider, calls = labelled
    monitor.poll_once()
    monitor.queue_backfill()
    backfill = [params for path, params in provider["calls"] if path == "messages"][-1]
    assert backfill["q"].startswith("newer_than:10d ") and "-in:sent" in backfill["q"]
    assert {mid for mid, (_, status) in categories(client).items()} == {
        "new-a",
        "new-b",
        "old",
        "sent",
    }
    # New-mail summaries go first and label their mail without a second model call.
    assert monitor.process_one() and monitor.process_one()
    assert calls == []
    assert categories(client)["new-a"] == ("学校邮件", "done")
    # Then the idle model labels the rest, newest first.
    assert monitor.process_one()
    assert calls == ["old"]
    while monitor.process_one():
        pass
    assert calls == ["old", "sent"]
    assert categories(client)["old"] == ("广告推广", "done")
    assert not monitor.model_lock.locked()
    # The inbox list and the notices show the stored labels.
    listed = client.get("/api/v1/messages").json()["items"]
    assert {item["id"]: item["category"] for item in listed}["old"] == "广告推广"
    assert all(item["category_status"] == "done" for item in listed)
    notices = client.get("/api/v1/mail-notifications").json()["items"]
    assert {item["category"] for item in notices} == {"学校邮件"}
    # A scan within ten minutes does not ask Gmail again.
    before = len(provider["calls"])
    monitor.queue_backfill()
    assert len(provider["calls"]) == before


def test_old_notices_are_relabelled_and_pending_labels_show_in_the_inbox(labelled):
    client, monitor, provider, calls = labelled
    monitor.poll_once()
    while monitor.process_one():
        pass
    # Pretend these notices were summarised before categories were stored.
    from app.models import MailCategoryRecord

    with client.app.state.session_factory() as db:
        db.execute(MailCategoryRecord.__table__.delete())
        db.commit()
    provider["initial"] = []
    monitor.queue_backfill()
    assert {mid: status for mid, (_, status) in categories(client).items()} == {
        "new-a": "pending",
        "new-b": "pending",
    }
    provider["initial"] = ["new-a", "new-b"]
    assert {item["category_status"] for item in client.get("/api/v1/messages").json()["items"]} == {
        "pending"
    }
    while monitor.process_one():
        pass
    assert sorted(calls) == ["new-a", "new-b"]
    notices = client.get("/api/v1/mail-notifications").json()["items"]
    assert all(
        item["category"] == "求职邮件" and item["summary"]["category"] == "求职邮件"
        for item in notices
    )


def test_failed_labels_retry_later_missing_mail_is_dropped_and_restart_recovers(
    labelled, monkeypatch
):
    client, monitor, provider, calls = labelled
    provider["initial"] = ["new-a", "gone"]
    monitor.queue_backfill()
    original_message = monitor.mail.google.message

    def message(token, id, full=False):
        if id == "gone":
            raise AuthError("MAIL_NOT_FOUND", "Synthetic missing mail", 404)
        return original_message(token, id, full)

    def fail(mail, language="zh"):
        raise SummaryError("SUMMARY_TIMEOUT")

    monkeypatch.setattr(monitor.mail.google, "message", message)
    monkeypatch.setattr(monitor.summarizer, "classify", fail)
    while monitor.process_one():
        pass
    assert categories(client) == {"new-a": ("", "failed")}
    listed = client.get("/api/v1/messages").json()["items"]
    assert {item["id"]: item["category_status"] for item in listed}["new-a"] is None
    # A failure is retried by a later scan once it is old enough.
    from app import mail_categories
    from app.models import MailCategoryRecord
    from sqlalchemy import update

    with client.app.state.session_factory() as db:
        db.execute(
            update(MailCategoryRecord).values(
                updated_at=int(time.time()) - mail_categories.RETRY_FAILED_AFTER - 1
            )
        )
        db.commit()
    monitor.queue_backfill(every=0)
    assert categories(client)["new-a"] == ("", "pending")
    with client.app.state.session_factory() as db:
        db.execute(update(MailCategoryRecord).values(status="processing"))
        db.commit()
    monitor.recover_pending()
    assert categories(client)["new-a"] == ("", "pending")


def test_labels_belong_to_one_user_and_go_with_the_mailbox(labelled):
    client, monitor, provider, calls = labelled
    monitor.queue_backfill()
    while monitor.process_one():
        pass
    assert categories(client)
    register(client, "label_other")
    login(client, "label_other")
    assert client.get("/api/v1/messages").json()["items"] == []
    with client.app.state.session_factory() as db:
        connection = db.scalar(select(EmailConnection))
        db.delete(connection)
        db.commit()
    assert categories(client) == {}
