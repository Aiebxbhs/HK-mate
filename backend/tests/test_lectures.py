import pytest
from app.models import LectureRecord
from sqlalchemy import select
from test_auth import login, register

BASE = "/api/v1/lecture-records"
RECORD = {
    "course_name": "  Deep   Learning ",
    "course_code": "DASC7606",
    "instructor": "Dr. Synthetic",
    "extra_info": "LE1，第 9 周",
    "started_at": "2026-11-12T19:00:00+08:00",
    "ended_at": "2026-11-12T21:50:00+08:00",
    "recorded_seconds": 0,
    "notes": [
        {"at_seconds": 1800, "text": "Adam = momentum + adaptive lr", "important": True},
        {"at_seconds": 120, "text": "  作业二下周五截止  "},
    ],
}


@pytest.fixture
def lectures(client, tmp_path):
    # Never touch the real key file during tests.
    client.app.state.mail.vault.path = tmp_path / "lecture-test.key"
    return client


def write(client, method, path, body=None):
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    return client.request(method, path, json=body, headers=headers)


def test_save_list_read_update_and_delete_a_lecture(lectures):
    assert lectures.get(BASE).status_code == 401
    assert write(lectures, "POST", BASE, RECORD).status_code == 401
    register(lectures)
    login(lectures)
    assert lectures.post(BASE, json=RECORD).status_code == 403  # CSRF still applies

    created = write(lectures, "POST", BASE, RECORD)
    assert created.status_code == 201
    record = created.json()
    assert record["course_name"] == "Deep Learning"
    assert record["duration_seconds"] == 170 * 60
    assert [note["at_seconds"] for note in record["notes"]] == [120, 1800]
    assert record["notes"][0]["text"] == "作业二下周五截止"
    assert record["important_count"] == 1 and record["note_count"] == 2
    assert record["summary"] is None and record["has_summary"] is False

    listed = lectures.get(BASE).json()["items"]
    assert [item["id"] for item in listed] == [record["id"]]
    assert "notes" not in listed[0] and "instructor" not in listed[0]

    path = f"{BASE}/{record['id']}"
    updated = write(
        lectures,
        "PATCH",
        path,
        {"course_name": "Deep Learning (LEC)", "notes": [{"at_seconds": 60, "text": "改过"}]},
    )
    assert updated.status_code == 200
    assert updated.json()["course_name"] == "Deep Learning (LEC)"
    assert updated.json()["instructor"] == "Dr. Synthetic"
    assert updated.json()["notes"] == [{"at_seconds": 60, "text": "改过", "important": False}]
    assert lectures.get(path).json()["notes"][0]["text"] == "改过"

    assert write(lectures, "DELETE", path).status_code == 204
    assert lectures.get(path).status_code == 404
    assert lectures.get(BASE).json()["items"] == []


def test_private_fields_are_encrypted_at_rest(lectures):
    register(lectures)
    login(lectures)
    write(lectures, "POST", BASE, RECORD)
    with lectures.app.state.session_factory() as db:
        row = db.scalar(select(LectureRecord))
    assert row.course_name == "Deep Learning" and row.course_code == "DASC7606"
    for secret in ("Dr. Synthetic", "Adam = momentum", "作业二", "LE1"):
        assert secret not in row.encrypted_payload


def test_records_are_isolated_between_accounts(lectures):
    register(lectures)
    login(lectures)
    record_id = write(lectures, "POST", BASE, RECORD).json()["id"]
    register(lectures, username="other_user")
    login(lectures, username="other_user")
    assert lectures.get(BASE).json()["items"] == []
    assert lectures.get(f"{BASE}/{record_id}").status_code == 404
    assert write(lectures, "PATCH", f"{BASE}/{record_id}", {"course_name": "x"}).status_code == 404
    assert write(lectures, "DELETE", f"{BASE}/{record_id}").status_code == 404
    login(lectures)
    assert lectures.get(f"{BASE}/{record_id}").status_code == 200


@pytest.mark.parametrize(
    "changes,status",
    [
        ({"course_name": "   "}, 400),
        ({"course_name": ""}, 422),
        ({"course_name": "x" * 101}, 422),
        ({"ended_at": "2026-11-12T19:00:00+08:00"}, 400),
        ({"ended_at": "2026-11-13T08:00:00+08:00"}, 400),
        ({"started_at": "2026-11-12T19:00:00"}, 400),
        ({"recorded_seconds": 20000}, 400),
        ({"recorded_seconds": 99999}, 422),
        ({"notes": [{"at_seconds": 20000, "text": "x"}]}, 400),
        ({"notes": [{"at_seconds": 99999, "text": "x"}]}, 422),
        ({"notes": [{"at_seconds": 10, "text": "   "}]}, 400),
        ({"notes": [{"at_seconds": 10, "text": "x", "speaker": "teacher"}]}, 422),
        ({"summary": {"overview": "fake"}}, 422),
        ({"user_id": "someone-else"}, 422),
    ],
)
def test_invalid_records_are_rejected(lectures, changes, status):
    register(lectures)
    login(lectures)
    assert write(lectures, "POST", BASE, RECORD | changes).status_code == status
    assert lectures.get(BASE).json()["items"] == []


def test_future_lectures_cannot_be_saved(lectures):
    register(lectures)
    login(lectures)
    body = RECORD | {
        "started_at": "2099-01-01T10:00:00+08:00",
        "ended_at": "2099-01-01T11:00:00+08:00",
    }
    assert write(lectures, "POST", BASE, body).status_code == 400


def test_transcript_is_saved_only_when_sent_and_stays_encrypted(lectures):
    register(lectures)
    login(lectures)
    without = write(lectures, "POST", BASE, RECORD).json()
    assert without["transcript"] is None
    lines = [
        {"at_seconds": 75.5, "en": "Adam combines momentum.", "zh": "Adam 结合了动量。"},
        {"at_seconds": 12, "en": "Good afternoon.", "zh": None},
        {"at_seconds": 13, "en": "   ", "zh": "空"},
    ]
    saved = write(lectures, "POST", BASE, RECORD | {"transcript": lines}).json()
    assert saved["transcript"] == [
        {"at_seconds": 12.0, "en": "Good afternoon.", "zh": None},
        {"at_seconds": 75.5, "en": "Adam combines momentum.", "zh": "Adam 结合了动量。"},
    ]
    with lectures.app.state.session_factory() as db:
        payloads = [row.encrypted_payload for row in db.scalars(select(LectureRecord))]
    assert all("Adam combines" not in payload for payload in payloads)
    too_late = [{"at_seconds": 20000, "en": "late"}]
    assert write(lectures, "POST", BASE, RECORD | {"transcript": too_late}).status_code == 400
    extra = [{"at_seconds": 1, "en": "x", "speaker": "prof"}]
    assert write(lectures, "POST", BASE, RECORD | {"transcript": extra}).status_code == 422
