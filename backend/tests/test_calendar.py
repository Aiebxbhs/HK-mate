from dataclasses import replace

import pytest
from app.calendar_service import (
    course_name_from_description,
    parse_hku_calendar,
    replace_hku_events,
)
from app.models import CalendarEvent
from app.services import AuthError
from sqlalchemy import select
from test_auth import login, register


def synthetic_ics(
    extra: str = "", start: str = "20261112T060000Z", end: str = "20261112T070000Z"
) -> bytes:
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Synthetic Test//EN\r\n"
        "BEGIN:VEVENT\r\nUID:synthetic-uid\r\nDTSTAMP:20261101T000000Z\r\n"
        f"DTSTART:{start}\r\nDTEND:{end}\r\n"
        "SUMMARY:Synthetic Course\r\nLOCATION:Room 301\r\n"
        "DESCRIPTION:Line one\\nLine two\\, with comma\r\n"
        f"{extra}END:VEVENT\r\nEND:VCALENDAR\r\n"
    ).encode()


def test_calendar_authentication_ownership_and_hong_kong_time(client):
    query = "/api/v1/calendar/events?start_date=2026-11-12&end_date=2026-11-13"
    assert client.get(query).status_code == 401
    owner = register(client).json()["id"]
    login(client)
    with client.app.state.session_factory() as db:
        replace_hku_events(db, owner, parse_hku_calendar(synthetic_ics()))
    response = client.get(query)
    assert response.status_code == 200
    data = response.json()
    assert data["total_events"] == 1
    assert data["items"][0]["starts_at"] == "2026-11-12T14:00:00+08:00"
    assert data["items"][0]["description"] == "Line one\nLine two, with comma"
    assert "external_uid" not in data["items"][0]
    register(client, username="other_user")
    login(client, username="other_user")
    assert client.get(query + f"&user_id={owner}").json() == {
        "source_name": "HKU 课表",
        "timezone": "Asia/Hong_Kong",
        "total_events": 0,
        "items": [],
    }


def test_local_date_overlap_and_exclusive_midnight_boundary(client):
    owner = register(client).json()["id"]
    login(client)
    events = parse_hku_calendar(synthetic_ics(start="20261112T153000Z", end="20261112T160000Z"))
    with client.app.state.session_factory() as db:
        replace_hku_events(db, owner, events)
    assert (
        len(
            client.get("/api/v1/calendar/events?start_date=2026-11-12&end_date=2026-11-13").json()[
                "items"
            ]
        )
        == 1
    )
    assert (
        client.get("/api/v1/calendar/events?start_date=2026-11-13&end_date=2026-11-14").json()[
            "items"
        ]
        == []
    )
    for query in (
        "start_date=2026-11-13&end_date=2026-11-12",
        "start_date=2026-01-01&end_date=2027-01-01",
    ):
        assert client.get("/api/v1/calendar/events?" + query).status_code == 400


def test_reimport_is_idempotent_and_replaces_only_this_owners_hku_events(client):
    owner = register(client).json()["id"]
    other = register(client, username="other_user").json()["id"]
    events = parse_hku_calendar(synthetic_ics())
    with client.app.state.session_factory() as db:
        replace_hku_events(db, owner, [events[0], replace(events[0], external_uid="second-uid")])
        original_id = db.scalar(
            select(CalendarEvent.id).where(CalendarEvent.external_uid == "synthetic-uid")
        )
        replace_hku_events(db, other, events)
        replace_hku_events(db, owner, [replace(events[0], title="Updated synthetic title")])
        replace_hku_events(db, owner, [replace(events[0], title="Updated synthetic title")])
        rows = list(db.scalars(select(CalendarEvent).where(CalendarEvent.user_id == owner)))
        assert len(rows) == 1 and rows[0].id == original_id
        assert rows[0].title == "Updated synthetic title"
        assert (
            len(list(db.scalars(select(CalendarEvent).where(CalendarEvent.user_id == other)))) == 1
        )


@pytest.mark.parametrize(
    "content",
    [
        b"not ICS",
        synthetic_ics("RRULE:FREQ=WEEKLY\r\n"),
        synthetic_ics(start="20261112T060000"),
        synthetic_ics(end="20261112T050000Z"),
    ],
)
def test_invalid_or_unsupported_import_preserves_existing_events(client, content):
    owner = register(client).json()["id"]
    with client.app.state.session_factory() as db:
        replace_hku_events(db, owner, parse_hku_calendar(synthetic_ics()))
        with pytest.raises(AuthError):
            replace_hku_events(db, owner, parse_hku_calendar(content))
        assert len(list(db.scalars(select(CalendarEvent)))) == 1


@pytest.mark.parametrize(
    "title,description,expected",
    [
        ("TEST1001-1A", "Synthetic Course (TEST1001-1A)", "Synthetic Course"),
        ("TEST1001-1A", "Synthetic Course(TEST1001-1A) Examination <C1>", "Synthetic Course"),
        ("TEST1001-1A", "Another Course (TEST2002-1A)", ""),
        ("TEST1001-1A", "No course-name field in this description", ""),
    ],
)
def test_course_name_comes_from_matching_source_description(title, description, expected):
    assert course_name_from_description(title, description) == expected


def write(client, method, path, body=None):
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    return client.request(method, path, json=body, headers=headers)


MANUAL = {
    "title": "  小组  讨论 ",
    "date": "2026-11-14",
    "start_time": "14:00",
    "end_time": "15:30",
    "location": " Library 3F ",
}
DAY_QUERY = "/api/v1/calendar/events?start_date=2026-11-14&end_date=2026-11-15"


def test_owner_can_add_and_delete_manual_events_in_hong_kong_time(client):
    assert write(client, "POST", "/api/v1/calendar/events", MANUAL).status_code == 401
    owner = register(client).json()["id"]
    login(client)
    with client.app.state.session_factory() as db:
        replace_hku_events(
            db,
            owner,
            parse_hku_calendar(synthetic_ics(start="20261114T010000Z", end="20261114T020000Z")),
        )
    created = write(client, "POST", "/api/v1/calendar/events", MANUAL)
    assert created.status_code == 201
    event = created.json()
    assert event["source"] == "manual"
    assert event["title"] == "小组 讨论"
    assert event["location"] == "Library 3F"
    assert event["starts_at"] == "2026-11-14T14:00:00+08:00"
    assert event["ends_at"] == "2026-11-14T15:30:00+08:00"

    listed = client.get(DAY_QUERY).json()
    assert listed["total_events"] == 2
    assert [item["source"] for item in listed["items"]] == ["hku", "manual"]

    # Writes still require the CSRF token and an allowed Origin.
    assert client.delete(f"/api/v1/calendar/events/{event['id']}").status_code == 403
    assert write(client, "DELETE", f"/api/v1/calendar/events/{event['id']}").status_code == 204
    assert write(client, "DELETE", f"/api/v1/calendar/events/{event['id']}").status_code == 404
    assert [item["source"] for item in client.get(DAY_QUERY).json()["items"]] == ["hku"]


def test_events_are_isolated_between_accounts(client):
    register(client)
    login(client)
    event_id = write(client, "POST", "/api/v1/calendar/events", MANUAL).json()["id"]
    register(client, username="other_user")
    login(client, username="other_user")
    assert client.get(DAY_QUERY).json()["items"] == []
    assert write(client, "DELETE", f"/api/v1/calendar/events/{event_id}").status_code == 404
    login(client)
    assert len(client.get(DAY_QUERY).json()["items"]) == 1


@pytest.mark.parametrize(
    "changes,status",
    [
        ({"title": "   "}, 400),
        ({"title": ""}, 422),
        ({"title": "x" * 201}, 422),
        ({"end_time": "14:00"}, 400),
        ({"end_time": "13:00"}, 400),
        ({"date": "1999-12-31"}, 400),
        ({"date": "2026-02-30"}, 422),
        ({"location": "x" * 201}, 422),
        ({"user_id": "someone-else"}, 422),
    ],
)
def test_manual_event_validation(client, changes, status):
    register(client)
    login(client)
    response = write(client, "POST", "/api/v1/calendar/events", MANUAL | changes)
    assert response.status_code == status
    assert client.get(DAY_QUERY).json()["items"] == []


DEADLINE = {
    "kind": "deadline",
    "title": "Assignment 2",
    "date": "2026-11-14",
    "start_time": "23:59",
}


def test_deadline_is_a_single_due_time(client):
    register(client)
    login(client)
    created = write(client, "POST", "/api/v1/calendar/events", DEADLINE)
    assert created.status_code == 201
    event = created.json()
    assert event["kind"] == "deadline" and event["completed"] is False
    assert event["starts_at"] == event["ends_at"] == "2026-11-14T23:59:00+08:00"
    assert [item["kind"] for item in client.get(DAY_QUERY).json()["items"]] == ["deadline"]
    # A deadline needs no end time, and an event still needs one.
    bad = write(client, "POST", "/api/v1/calendar/events", DEADLINE | {"end_time": "23:59"})
    assert bad.status_code == 400
    no_end = {key: value for key, value in MANUAL.items()}
    assert write(client, "POST", "/api/v1/calendar/events", no_end).status_code == 201
    assert (
        write(client, "POST", "/api/v1/calendar/events", MANUAL | {"end_time": None}).status_code
        == 400
    )
    assert (
        write(client, "POST", "/api/v1/calendar/events", DEADLINE | {"kind": "todo"}).status_code
        == 422
    )


def test_midnight_deadline_belongs_to_the_day_it_starts(client):
    register(client)
    login(client)
    write(client, "POST", "/api/v1/calendar/events", DEADLINE | {"start_time": "00:00"})
    assert len(client.get(DAY_QUERY).json()["items"]) == 1
    previous = "/api/v1/calendar/events?start_date=2026-11-13&end_date=2026-11-14"
    assert client.get(previous).json()["items"] == []


def test_completion_toggles_survives_reimport_and_is_owner_only(client):
    owner = register(client).json()["id"]
    login(client)
    with client.app.state.session_factory() as db:
        replace_hku_events(
            db,
            owner,
            parse_hku_calendar(synthetic_ics(start="20261114T010000Z", end="20261114T020000Z")),
        )
    course = client.get(DAY_QUERY).json()["items"][0]
    path = f"/api/v1/calendar/events/{course['id']}/completion"
    assert client.post(path, json={"completed": True}).status_code == 403
    done = write(client, "POST", path, {"completed": True})
    assert done.status_code == 200 and done.json()["completed"] is True
    assert write(client, "POST", path, {"completed": True}).json()["completed"] is True

    with client.app.state.session_factory() as db:
        replace_hku_events(
            db,
            owner,
            parse_hku_calendar(synthetic_ics(start="20261114T010000Z", end="20261114T020000Z")),
        )
    assert client.get(DAY_QUERY).json()["items"][0]["completed"] is True

    register(client, username="other_user")
    login(client, username="other_user")
    assert write(client, "POST", path, {"completed": False}).status_code == 404
    login(client)
    assert write(client, "POST", path, {"completed": False}).json()["completed"] is False
    assert write(client, "POST", path, {"completed": "yes", "x": 1}).status_code == 422


def test_courses_group_weekly_slots_and_exams_per_owner(client):
    assert client.get("/api/v1/calendar/courses").status_code == 401
    owner = register(client).json()["id"]
    login(client)
    [base] = parse_hku_calendar(synthetic_ics())
    week = 7 * 24 * 3600
    lecture = replace(
        base,
        title="TEST1001-1A (LEC)",
        description="Synthetic Course (TEST1001-1A)",
        location="LE1",
        starts_at=1793617200,  # Monday 2026-11-02 19:00 Hong Kong
        ends_at=1793617200 + 3 * 3600,  # 22:00
    )
    events = [
        replace(
            lecture,
            external_uid=f"lec-{n}",
            starts_at=lecture.starts_at + n * week,
            ends_at=lecture.ends_at + n * week,
        )
        for n in range(3)
    ]
    events.append(
        replace(
            lecture,
            external_uid="exam",
            title="TEST1001-1A Examination",
            location="Hall",
            starts_at=lecture.starts_at + 6 * week,
            ends_at=lecture.starts_at + 6 * week + 7200,
        )
    )
    events.append(replace(base, external_uid="other", title="Orientation Talk"))
    with client.app.state.session_factory() as db:
        replace_hku_events(db, owner, events)
    courses = client.get("/api/v1/calendar/courses").json()["courses"]
    by_code = {course["code"]: course for course in courses}
    course = by_code["TEST1001"]
    assert course["section"] == "1A" and course["course_name"] == "Synthetic Course"
    assert course["sessions"] == 3
    assert course["first_date"] == "2026-11-02" and course["last_date"] == "2026-11-16"
    assert course["slots"] == [
        {"weekday": 0, "start": "19:00", "end": "22:00", "location": "LE1", "count": 3}
    ]
    [exam] = course["exams"]
    assert exam["starts_at"] == "2026-12-14T19:00:00+08:00" and exam["location"] == "Hall"
    # An event without a course code keeps its own entry instead of being dropped.
    assert by_code["Orientation Talk"]["sessions"] == 1
    register(client, username="other_user")
    login(client, username="other_user")
    assert client.get("/api/v1/calendar/courses").json()["courses"] == []


FEED_LINK = "webcal://sis-eportal.hku.hk/calendar/feed.ics?token=SECRET-TOKEN-123"
ALL_DAY = (
    "BEGIN:VEVENT\r\nUID:holiday\r\nDTSTAMP:20261101T000000Z\r\n"
    "DTSTART;VALUE=DATE:20261225\r\nDTEND;VALUE=DATE:20261226\r\n"
    "SUMMARY:University Holiday\r\nEND:VEVENT\r\n"
)


def feed_with_holiday() -> bytes:
    return synthetic_ics().replace(b"END:VCALENDAR", ALL_DAY.encode() + b"END:VCALENDAR")


def serve_feed(monkeypatch, handler):
    """Route the import's HTTP client to a fake HKU server; no real network is used."""
    import httpx
    from app import calendar_service

    seen = []

    def recording(request):
        seen.append(str(request.url))
        return handler(request)

    monkeypatch.setattr(
        calendar_service,
        "feed_client",
        lambda: httpx.Client(transport=httpx.MockTransport(recording), follow_redirects=False),
    )
    return seen


@pytest.mark.parametrize(
    "link",
    [
        "http://sis-eportal.hku.hk/feed.ics",
        "https://evil.example/feed.ics",
        "https://hku.hk.evil.example/feed.ics",
        "https://user:pw@sis-eportal.hku.hk/feed.ics",
        "https://sis-eportal.hku.hk:8443/feed.ics",
        "file:///etc/passwd",
        "not a link",
    ],
)
def test_feed_link_must_be_an_hku_https_address(link):
    from app.calendar_service import hku_feed_url

    with pytest.raises(AuthError) as error:
        hku_feed_url(link)
    assert error.value.code == "CALENDAR_URL_INVALID"


def test_import_from_hku_link_skips_all_day_and_keeps_manual_events(client, monkeypatch):
    import httpx

    seen = serve_feed(monkeypatch, lambda request: httpx.Response(200, content=feed_with_holiday()))
    assert write(client, "POST", "/api/v1/calendar/import", {"url": FEED_LINK}).status_code in (
        401,
        403,
    )
    register(client)
    login(client)
    assert write(client, "POST", "/api/v1/calendar/events", MANUAL).status_code == 201
    response = write(client, "POST", "/api/v1/calendar/import", {"url": FEED_LINK})
    assert response.status_code == 200
    assert response.json() == {"imported": 1, "skipped_all_day": 1}
    # webcal:// is fetched as https://, and only once.
    assert seen == ["https://sis-eportal.hku.hk/calendar/feed.ics?token=SECRET-TOKEN-123"]
    items = client.get(DAY_QUERY.replace("2026-11-14&", "2026-11-12&")).json()["items"]
    assert {item["source"] for item in items} == {"hku", "manual"}
    courses = client.get("/api/v1/calendar/courses").json()["courses"]
    assert [course["code"] for course in courses] == ["Synthetic Course"]
    with client.app.state.session_factory() as db:
        stored = " ".join(
            f"{row.title} {row.description} {row.location}"
            for row in db.scalars(select(CalendarEvent))
        )
    assert "SECRET-TOKEN" not in stored


def test_failed_or_redirected_feed_changes_nothing_and_hides_the_link(client, monkeypatch):
    import httpx

    register(client)
    login(client)
    serve_feed(
        monkeypatch,
        lambda request: httpx.Response(302, headers={"location": "https://evil.example/x"}),
    )
    response = write(client, "POST", "/api/v1/calendar/import", {"url": FEED_LINK})
    assert response.status_code == 502
    assert "SECRET-TOKEN" not in response.text
    serve_feed(monkeypatch, lambda request: httpx.Response(404))
    assert write(client, "POST", "/api/v1/calendar/import", {"url": FEED_LINK}).status_code == 502
    serve_feed(monkeypatch, lambda request: httpx.Response(200, content=b"<html>login</html>"))
    response = write(client, "POST", "/api/v1/calendar/import", {"url": FEED_LINK})
    assert response.status_code == 400 and response.json()["error"]["code"] == "CALENDAR_INVALID"
    assert client.get("/api/v1/calendar/courses").json()["courses"] == []


def test_owner_can_edit_own_schedule_items_only(client):
    owner = register(client).json()["id"]
    login(client)
    created = write(client, "POST", "/api/v1/calendar/events", MANUAL).json()
    write(
        client, "POST", f"/api/v1/calendar/events/{created['id']}/completion", {"completed": True}
    )
    path = f"/api/v1/calendar/events/{created['id']}"
    changed = {
        "title": "  组会 ",
        "date": "2026-11-15",
        "start_time": "09:00",
        "end_time": "10:15",
        "location": " CPD-3.04 ",
    }
    response = write(client, "PUT", path, changed)
    assert response.status_code == 200
    edited = response.json()
    assert edited["id"] == created["id"] and edited["completed"] is True
    assert edited["title"] == "组会" and edited["location"] == "CPD-3.04"
    assert edited["starts_at"] == "2026-11-15T09:00:00+08:00"
    assert edited["ends_at"] == "2026-11-15T10:15:00+08:00"
    # An event can become a deadline (a single due time) and back.
    deadline = {"kind": "deadline", "title": "Essay", "date": "2026-11-20", "start_time": "23:59"}
    edited = write(client, "PUT", path, deadline).json()
    assert edited["kind"] == "deadline" and edited["starts_at"] == edited["ends_at"]
    bad = {**changed, "end_time": "08:00"}
    assert write(client, "PUT", path, bad).status_code == 400
    assert write(client, "PUT", path, {**changed, "source": "hku"}).status_code == 422

    # HKU courses are read-only; other people's items cannot be found.
    with client.app.state.session_factory() as db:
        replace_hku_events(db, owner, parse_hku_calendar(synthetic_ics()))
        course = db.scalar(select(CalendarEvent).where(CalendarEvent.source == "hku"))
    response = write(client, "PUT", f"/api/v1/calendar/events/{course.id}", changed)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "CALENDAR_EVENT_READ_ONLY"
    register(client, username="other_user")
    login(client, username="other_user")
    assert write(client, "PUT", path, changed).status_code == 404
    client.cookies.clear()
    assert write(client, "PUT", path, changed).status_code in (401, 403)
