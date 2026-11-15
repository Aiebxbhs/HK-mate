"""Calendar business logic: date-range queries, and importing an HKU timetable from a local
ICS snapshot or, once, from the user's HKU subscription link (the link is never retained)."""

import re
import time
from dataclasses import dataclass
from datetime import date, datetime
from datetime import time as day_time
from urllib.parse import urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
from icalendar import Calendar
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models import CalendarEvent, User
from app.services import AuthError

HONG_KONG = ZoneInfo("Asia/Hong_Kong")
SOURCES = ("hku", "manual")
MAX_CALENDAR_BYTES = 5 * 1024 * 1024
FEED_TIMEOUT_SECONDS = 20


def hku_feed_url(link: str) -> str:
    """Accept only an HKU-hosted calendar link (https or webcal), so the server never fetches
    other hosts on a user's behalf. The link is used once and never stored or logged."""
    invalid = AuthError(
        "CALENDAR_URL_INVALID",
        "请粘贴 HKU Event Calendar 的订阅链接（hku.hk 网址，以 https:// 或 webcal:// 开头）。",
        400,
    )
    link = link.strip()
    if any(ch.isspace() for ch in link):
        raise invalid
    if link.lower().startswith("webcal://"):
        link = "https://" + link[len("webcal://") :]
    try:
        parts = urlsplit(link)
        port = parts.port
    except ValueError:
        raise invalid from None
    host = (parts.hostname or "").lower().rstrip(".")
    if (
        parts.scheme.lower() != "https"
        or parts.username
        or parts.password
        or port not in (None, 443)
        or not (host == "hku.hk" or host.endswith(".hku.hk"))
    ):
        raise invalid
    return link


def feed_client() -> httpx.Client:
    return httpx.Client(timeout=FEED_TIMEOUT_SECONDS, follow_redirects=False)


def fetch_hku_feed(link: str) -> bytes:
    """Download the subscription feed once. Redirects are followed only within hku.hk, and
    errors never echo the link (it carries the user's personal token)."""
    failed = AuthError(
        "CALENDAR_FETCH_FAILED",
        "没能从 HKU 下载课表，请确认链接完整、已在 HKU 页面点击 SAVE，稍后再试。",
        502,
    )
    url = hku_feed_url(link)
    try:
        with feed_client() as client:
            for _ in range(4):
                with client.stream("GET", url, headers={"Accept": "text/calendar"}) as response:
                    if response.is_redirect:
                        url = hku_feed_url(str(response.url.join(response.headers["location"])))
                        continue
                    if response.status_code != 200:
                        raise failed
                    content = bytearray()
                    for chunk in response.iter_bytes():
                        content += chunk
                        if len(content) > MAX_CALENDAR_BYTES:
                            raise AuthError("CALENDAR_INVALID", "日历文件过大。", 400)
                    return bytes(content)
    except AuthError as exc:
        if exc.code == "CALENDAR_URL_INVALID":
            raise failed from None
        raise
    except (httpx.HTTPError, KeyError):
        raise failed from None
    raise failed


def events_between(
    db: Session, user_id: str, start_date: date, end_date: date, limit: int = 1000
) -> list[CalendarEvent]:
    """The user's events overlapping [start_date, end_date) in Hong Kong time, at most
    `limit` + 1 rows so callers can tell when the range holds too many."""
    start = int(datetime.combine(start_date, day_time.min, HONG_KONG).timestamp())
    end = int(datetime.combine(end_date, day_time.min, HONG_KONG).timestamp())
    return list(
        db.scalars(
            select(CalendarEvent)
            .where(
                CalendarEvent.user_id == user_id,
                CalendarEvent.source.in_(SOURCES),
                CalendarEvent.starts_at < end,
                # Deadlines are instants (starts_at == ends_at); include one due at midnight.
                or_(
                    CalendarEvent.ends_at > start,
                    and_(
                        CalendarEvent.starts_at == CalendarEvent.ends_at,
                        CalendarEvent.starts_at >= start,
                    ),
                ),
            )
            .order_by(CalendarEvent.starts_at, CalendarEvent.id)
            .limit(limit + 1)
        )
    )


COURSE_CODE = re.compile(r"\b([A-Z]{4}\d{4})(?:[-_]([0-9A-Z]+))?", re.IGNORECASE)


@dataclass
class CourseSlot:
    weekday: int  # 0 = Monday, Hong Kong time
    start: str  # "HH:MM"
    end: str
    location: str
    count: int


@dataclass
class CourseExam:
    starts_at: datetime
    ends_at: datetime
    location: str


@dataclass
class CourseSummary:
    code: str
    section: str
    course_name: str
    sessions: int
    first_date: date | None
    last_date: date | None
    slots: list[CourseSlot]
    exams: list[CourseExam]


def is_exam(title: str) -> bool:
    return "examination" in title.lower()


def course_summaries(db: Session, user_id: str) -> list[CourseSummary]:
    """The user's imported HKU courses, grouped by course code, with their weekly class
    times and exams (Hong Kong time). Titles without a course code form their own group."""
    rows = db.scalars(
        select(CalendarEvent)
        .where(CalendarEvent.user_id == user_id, CalendarEvent.source == "hku")
        .order_by(CalendarEvent.starts_at, CalendarEvent.id)
    )
    groups: dict[str, dict] = {}
    for row in rows:
        match = COURSE_CODE.search(row.title)
        key = match[1].upper() if match else row.title.strip()
        group = groups.setdefault(
            key,
            {"section": "", "name": "", "slots": {}, "dates": [], "exams": []},
        )
        if match and match[2] and not group["section"]:
            group["section"] = match[2].upper()
        if not group["name"]:
            group["name"] = course_name_from_description(row.title, row.description)
        starts = datetime.fromtimestamp(row.starts_at, HONG_KONG)
        ends = datetime.fromtimestamp(row.ends_at, HONG_KONG)
        if is_exam(row.title):
            group["exams"].append(CourseExam(starts, ends, row.location))
            continue
        group["dates"].append(starts.date())
        slot = (starts.weekday(), f"{starts:%H:%M}", f"{ends:%H:%M}", row.location)
        group["slots"][slot] = group["slots"].get(slot, 0) + 1
    return [
        CourseSummary(
            code=key,
            section=group["section"],
            course_name=group["name"],
            sessions=len(group["dates"]),
            first_date=min(group["dates"], default=None),
            last_date=max(group["dates"], default=None),
            slots=[
                CourseSlot(weekday, start, end, location, count)
                for (weekday, start, end, location), count in sorted(group["slots"].items())
            ],
            exams=group["exams"],
        )
        for key, group in sorted(groups.items())
    ]


@dataclass
class ImportedEvent:
    external_uid: str
    title: str
    location: str
    description: str
    starts_at: int
    ends_at: int


def course_name_from_description(title: str, description: str) -> str:
    """Extract the feed's course-name prefix only when its code matches the title."""
    code = re.search(r"\b[A-Z]{4}\d{4}\b", title, re.IGNORECASE)
    match = re.match(r"^\s*(.+?)\s*\(([A-Z]{4}\d{4})(?:-[^)]+)?\)", description, re.IGNORECASE)
    if not code or not match or code[0].upper() != match[2].upper():
        return ""
    return match[1].strip()


def parse_hku_calendar(content: bytes) -> list[ImportedEvent]:
    """A local ICS snapshot: anything unsupported, all-day events included, rejects it all."""
    return parse_calendar(content, skip_all_day=False)[0]


def parse_hku_feed(content: bytes) -> tuple[list[ImportedEvent], int]:
    """The HKU Event Calendar subscription feed. It may also carry all-day entries such as
    University Holidays; they are not classes, so they are skipped and counted, not stored."""
    return parse_calendar(content, skip_all_day=True)


def parse_calendar(content: bytes, *, skip_all_day: bool) -> tuple[list[ImportedEvent], int]:
    if len(content) > MAX_CALENDAR_BYTES:
        raise AuthError("CALENDAR_INVALID", "日历文件过大。", 400)
    try:
        calendar = Calendar.from_ical(content)
        if calendar.name != "VCALENDAR":
            raise ValueError()
        events, seen, skipped = [], set(), 0
        for component in calendar.walk("VEVENT"):
            if any(key in component for key in ("RRULE", "RDATE", "EXDATE", "RECURRENCE-ID")):
                raise AuthError(
                    "CALENDAR_RECURRENCE_UNSUPPORTED",
                    "本次导入暂不支持重复规则，请先展开事件。",
                    400,
                )
            if str(component.get("STATUS", "")) == "CANCELLED":
                continue
            uid = str(component.get("UID", "")).strip()
            title = str(component.get("SUMMARY", "")).strip()
            location = str(component.get("LOCATION", ""))
            description = str(component.get("DESCRIPTION", ""))
            start = component["DTSTART"].dt
            if skip_all_day and isinstance(start, date) and not isinstance(start, datetime):
                skipped += 1
                continue
            end = component["DTEND"].dt
            if (
                component.errors
                or not uid
                or uid in seen
                or len(uid) > 1024
                or not title
                or len(title) > 500
                or len(location) > 2000
                or len(description) > 20000
                or not isinstance(start, datetime)
                or not isinstance(end, datetime)
                or start.utcoffset() is None
                or end.utcoffset() is None
                or end <= start
            ):
                raise ValueError()
            seen.add(uid)
            events.append(
                ImportedEvent(
                    uid, title, location, description, int(start.timestamp()), int(end.timestamp())
                )
            )
            if len(events) > 1000:
                raise ValueError()
        if not events:
            raise ValueError()
        return events, skipped
    except AuthError:
        raise
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        raise AuthError(
            "CALENDAR_INVALID", "日历格式、时间或事件标识无效，未修改已有日程。", 400
        ) from None


def replace_hku_events(db: Session, user_id: str, events: list[ImportedEvent]) -> int:
    """Atomically replace this owner's HKU snapshot, keeping unchanged event IDs."""
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise AuthError("CALENDAR_OWNER_INVALID", "日历所属账号不可用。", 400)
    existing = {
        row.external_uid: row
        for row in db.scalars(
            select(CalendarEvent).where(
                CalendarEvent.user_id == user_id, CalendarEvent.source == "hku"
            )
        )
    }
    now = int(time.time())
    try:
        for event in events:
            row = existing.pop(event.external_uid, None)
            if row is None:
                row = CalendarEvent(
                    id=str(uuid4()), user_id=user_id, source="hku", external_uid=event.external_uid
                )
            for name in ("title", "location", "description", "starts_at", "ends_at"):
                setattr(row, name, getattr(event, name))
            row.imported_at = now
            db.add(row)
        for row in existing.values():
            db.delete(row)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return len(events)
