import time as clock
from datetime import date, datetime, time
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import services
from app.api import database
from app.calendar_service import (
    SOURCES,
    course_name_from_description,
    course_summaries,
    events_between,
    fetch_hku_feed,
    parse_hku_feed,
    replace_hku_events,
)
from app.core.security import SESSION_COOKIE
from app.models import CalendarEvent
from app.schemas import ErrorOutput
from app.services import AuthError

HONG_KONG = ZoneInfo("Asia/Hong_Kong")
router = APIRouter(
    prefix="/api/v1/calendar",
    responses={code: {"model": ErrorOutput} for code in (400, 401, 404, 422)},
)


class CalendarEventOutput(BaseModel):
    id: str
    source: Literal["hku", "manual"] = "hku"
    kind: Literal["event", "deadline"] = "event"
    completed: bool = False
    title: str
    course_name: str = ""
    location: str
    description: str
    starts_at: datetime
    ends_at: datetime


class CalendarOutput(BaseModel):
    source_name: str = "HKU 课表"
    timezone: str = "Asia/Hong_Kong"
    total_events: int
    items: list[CalendarEventOutput]


@router.get("/events", response_model=CalendarOutput)
def events(
    request: Request, start_date: date, end_date: date, db: Session = Depends(database)
) -> CalendarOutput:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    if not 0 < (end_date - start_date).days <= 100:
        raise AuthError("CALENDAR_RANGE_INVALID", "日历查询范围应为 1–100 天。", 400)
    ownership = (CalendarEvent.user_id == user.id, CalendarEvent.source.in_(SOURCES))
    rows = events_between(db, user.id, start_date, end_date)
    if len(rows) > 1000:
        raise AuthError("CALENDAR_RANGE_INVALID", "日程过多，请缩小查询日期范围。", 400)
    return CalendarOutput(
        total_events=db.scalar(select(func.count()).select_from(CalendarEvent).where(*ownership))
        or 0,
        items=[event_output(row) for row in rows],
    )


class CourseSlotOutput(BaseModel):
    weekday: int = Field(description="0 = Monday, Hong Kong time")
    start: str
    end: str
    location: str
    count: int


class CourseExamOutput(BaseModel):
    starts_at: datetime
    ends_at: datetime
    location: str


class CourseOutput(BaseModel):
    code: str
    section: str
    course_name: str
    sessions: int
    first_date: date | None
    last_date: date | None
    slots: list[CourseSlotOutput]
    exams: list[CourseExamOutput]


class CoursesOutput(BaseModel):
    timezone: str = "Asia/Hong_Kong"
    courses: list[CourseOutput]


class FeedImportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=2048)


class FeedImportOutput(BaseModel):
    imported: int
    skipped_all_day: int


@router.post("/import", response_model=FeedImportOutput, responses={502: {"model": ErrorOutput}})
def import_feed(
    body: FeedImportInput, request: Request, db: Session = Depends(database)
) -> FeedImportOutput:
    """Replace the signed-in user's HKU courses from their HKU Event Calendar link, once.
    The link is not stored, logged or returned; manual schedule items are not touched."""
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    events, skipped = parse_hku_feed(fetch_hku_feed(body.url))
    return FeedImportOutput(
        imported=replace_hku_events(db, user.id, events), skipped_all_day=skipped
    )


@router.get("/courses", response_model=CoursesOutput)
def courses(request: Request, db: Session = Depends(database)) -> CoursesOutput:
    """The signed-in user's imported HKU courses for the timetable page."""
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    return CoursesOutput(
        courses=[
            CourseOutput(
                code=course.code,
                section=course.section,
                course_name=course.course_name,
                sessions=course.sessions,
                first_date=course.first_date,
                last_date=course.last_date,
                slots=[CourseSlotOutput(**vars(slot)) for slot in course.slots],
                exams=[CourseExamOutput(**vars(exam)) for exam in course.exams],
            )
            for course in course_summaries(db, user.id)
        ]
    )


def event_output(row: CalendarEvent) -> CalendarEventOutput:
    return CalendarEventOutput(
        id=row.id,
        source=row.source,
        kind=row.kind if row.kind in ("event", "deadline") else "event",
        completed=row.completed_at is not None,
        title=row.title,
        course_name=(
            course_name_from_description(row.title, row.description) if row.source == "hku" else ""
        ),
        location=row.location,
        description=row.description,
        starts_at=datetime.fromtimestamp(row.starts_at, HONG_KONG),
        ends_at=datetime.fromtimestamp(row.ends_at, HONG_KONG),
    )


class ManualEventInput(BaseModel):
    """A same-day event, or a deadline at start_time, in Hong Kong time."""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["event", "deadline"] = "event"
    title: str = Field(min_length=1, max_length=200)
    date: date
    start_time: time
    end_time: time | None = None
    location: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=2000)


def validated_times(body: "ManualEventInput") -> tuple[str, datetime, datetime]:
    """Normalised title and Hong Kong start/end for a manual event or deadline."""
    title = " ".join(body.title.split())
    if not title:
        raise AuthError("CALENDAR_EVENT_INVALID", "请填写日程标题。", 400)
    if not date(2000, 1, 1) <= body.date <= date(2100, 12, 31):
        raise AuthError("CALENDAR_EVENT_INVALID", "日期超出可保存的范围。", 400)
    if body.kind == "deadline":
        if body.end_time is not None:
            raise AuthError("CALENDAR_EVENT_INVALID", "截止事项只需要一个截止时间。", 400)
    elif body.end_time is None or body.end_time <= body.start_time:
        raise AuthError("CALENDAR_EVENT_INVALID", "结束时间需要晚于开始时间。", 400)
    start = datetime.combine(body.date, body.start_time.replace(tzinfo=None), HONG_KONG)
    end = (
        start
        if body.end_time is None
        else datetime.combine(body.date, body.end_time.replace(tzinfo=None), HONG_KONG)
    )
    return title, start, end


@router.post("/events", response_model=CalendarEventOutput, status_code=201)
def create_event(
    body: ManualEventInput, request: Request, db: Session = Depends(database)
) -> CalendarEventOutput:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    title, start, end = validated_times(body)
    count = db.scalar(
        select(func.count())
        .select_from(CalendarEvent)
        .where(CalendarEvent.user_id == user.id, CalendarEvent.source == "manual")
    )
    if (count or 0) >= 2000:
        raise AuthError("CALENDAR_EVENT_LIMIT", "自建日程已达上限，请先删除旧日程。", 400)
    event_id = str(uuid4())
    row = CalendarEvent(
        id=event_id,
        user_id=user.id,
        source="manual",
        kind=body.kind,
        external_uid=event_id,
        title=title,
        location=body.location.strip(),
        description=body.description.strip(),
        starts_at=int(start.timestamp()),
        ends_at=int(end.timestamp()),
        imported_at=int(clock.time()),
    )
    db.add(row)
    db.commit()
    return event_output(row)


def owned_event(db: Session, user_id: str, event_id: str) -> CalendarEvent:
    row = db.scalar(
        select(CalendarEvent).where(
            CalendarEvent.id == event_id,
            CalendarEvent.user_id == user_id,
            CalendarEvent.source.in_(SOURCES),
        )
    )
    if row is None:
        raise AuthError("CALENDAR_EVENT_NOT_FOUND", "日程不存在或已被删除。", 404)
    return row


class ManualEventUpdate(ManualEventInput):
    """Same fields as adding; description left out keeps the current one."""

    description: str | None = Field(default=None, max_length=2000)


@router.put("/events/{event_id}", response_model=CalendarEventOutput)
def update_event(
    event_id: str, body: ManualEventUpdate, request: Request, db: Session = Depends(database)
) -> CalendarEventOutput:
    """Edit one of the user's own schedule items. HKU courses come from the school's
    timetable and would be overwritten by the next import, so they are not editable."""
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    row = owned_event(db, user.id, event_id)
    if row.source != "manual":
        raise AuthError(
            "CALENDAR_EVENT_READ_ONLY", "HKU 课程来自学校课表，不能编辑；可以删除或标记完成。", 400
        )
    title, start, end = validated_times(body)
    row.kind = body.kind
    row.title = title
    row.location = body.location.strip()
    if body.description is not None:
        row.description = body.description.strip()
    row.starts_at = int(start.timestamp())
    row.ends_at = int(end.timestamp())
    db.commit()
    return event_output(row)


class CompletionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    completed: bool


@router.post("/events/{event_id}/completion", response_model=CalendarEventOutput)
def set_completion(
    event_id: str, body: CompletionInput, request: Request, db: Session = Depends(database)
) -> CalendarEventOutput:
    """Mark done or undo; works for HKU classes too and survives a calendar re-import."""
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    row = owned_event(db, user.id, event_id)
    if body.completed and row.completed_at is None:
        row.completed_at = int(clock.time())
    elif not body.completed:
        row.completed_at = None
    db.commit()
    return event_output(row)


@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: str, request: Request, db: Session = Depends(database)) -> Response:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    row = owned_event(db, user.id, event_id)
    db.delete(row)
    db.commit()
    return Response(status_code=204)
