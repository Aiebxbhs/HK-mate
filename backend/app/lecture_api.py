"""Saved lecture records (course info, notes, optional AI summary and transcript) and the
after-class summary endpoint.

Course name and code stay in plain columns so records can be grouped; the instructor, extra
information, notes, summary and transcript are stored as Fernet-encrypted JSON. Nothing is
saved unless the user chooses to save at the end of a course.
"""

import json
import time
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import services
from app.api import database
from app.core.security import SESSION_COOKIE
from app.i18n import request_language
from app.lecture_summary import SUMMARY_VERSION, Line, MentionKind, Note, SummaryError
from app.models import LectureRecord
from app.schemas import ErrorOutput
from app.services import AuthError

router = APIRouter(
    prefix="/api/v1/lecture-records",
    responses={code: {"model": ErrorOutput} for code in (400, 401, 403, 404, 422, 503)},
)
MAX_LECTURE_SECONDS = 12 * 3600


class LectureNote(BaseModel):
    model_config = ConfigDict(extra="forbid")
    at_seconds: int = Field(ge=0, le=MAX_LECTURE_SECONDS)
    text: str = Field(min_length=1, max_length=2000)
    important: bool = False


class TranscriptLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    at_seconds: float = Field(ge=0, le=MAX_LECTURE_SECONDS)
    en: str = Field(min_length=1, max_length=2000)
    zh: str | None = Field(default=None, max_length=2000)


class SummaryQuote(BaseModel):
    model_config = ConfigDict(extra="forbid")
    at_seconds: float = Field(ge=0, le=MAX_LECTURE_SECONDS)
    en: str = Field(min_length=1, max_length=400)


class SummaryPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=400)
    at_seconds: float = Field(ge=0, le=MAX_LECTURE_SECONDS)
    quotes: list[SummaryQuote] = Field(max_length=2)


class SummaryReminder(SummaryPoint):
    kind: MentionKind


class LectureSummary(BaseModel):
    """What the summarizer returns; saved as-is when the user keeps the summary."""

    model_config = ConfigDict(extra="forbid")
    version: str = Field(max_length=40)
    model: str = Field(max_length=100)
    generated_at: datetime
    overview: str = Field(min_length=1, max_length=800)
    key_points: list[SummaryPoint] = Field(min_length=1, max_length=12)
    reminders: list[SummaryReminder] = Field(max_length=8)
    line_count: int = Field(ge=0)
    part_count: int = Field(ge=0)
    elapsed_seconds: float = Field(ge=0)


class LectureInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_name: str = Field(min_length=1, max_length=100)
    course_code: str = Field(default="", max_length=40)
    instructor: str = Field(default="", max_length=100)
    extra_info: str = Field(default="", max_length=2000)


class LectureRecordInput(LectureInfo):
    started_at: datetime
    ended_at: datetime
    recorded_seconds: int = Field(default=0, ge=0, le=MAX_LECTURE_SECONDS)
    notes: list[LectureNote] = Field(default_factory=list, max_length=500)
    # Optional: only when the user ticks "save the transcript" (off by default).
    transcript: list[TranscriptLine] | None = Field(default=None, max_length=20000)
    # Optional: only when the user keeps the AI summary shown in the save form.
    summary: LectureSummary | None = None


class LectureRecordUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_name: str | None = Field(default=None, min_length=1, max_length=100)
    course_code: str | None = Field(default=None, max_length=40)
    instructor: str | None = Field(default=None, max_length=100)
    extra_info: str | None = Field(default=None, max_length=2000)
    notes: list[LectureNote] | None = Field(default=None, max_length=500)


class LectureRecordItem(BaseModel):
    id: str
    course_name: str
    course_code: str
    started_at: datetime
    ended_at: datetime
    duration_seconds: int
    recorded_seconds: int
    note_count: int
    important_count: int
    has_summary: bool
    created_at: datetime
    updated_at: datetime


class LectureRecordDetail(LectureRecordItem):
    instructor: str
    extra_info: str
    notes: list[LectureNote]
    summary: LectureSummary | None = None
    transcript: list[TranscriptLine] | None = None


class LectureRecordList(BaseModel):
    items: list[LectureRecordItem]


def clean(text: str) -> str:
    return " ".join(text.split())


def epoch(value: datetime) -> int:
    if value.tzinfo is None:
        raise AuthError("LECTURE_INVALID", "时间需要包含时区。", 400)
    return int(value.timestamp())


def as_time(value: int) -> datetime:
    return datetime.fromtimestamp(value, UTC)


def read_payload(request: Request, row: LectureRecord) -> dict:
    return json.loads(request.app.state.mail.vault.decrypt(row.encrypted_payload))


def write_payload(request: Request, row: LectureRecord, payload: dict) -> None:
    row.encrypted_payload = request.app.state.mail.vault.encrypt(
        json.dumps(payload, ensure_ascii=False), create=True
    )


def item(row: LectureRecord, payload: dict) -> LectureRecordItem:
    notes = payload.get("notes", [])
    return LectureRecordItem(
        id=row.id,
        course_name=row.course_name,
        course_code=row.course_code,
        started_at=as_time(row.started_at),
        ended_at=as_time(row.ended_at),
        duration_seconds=row.ended_at - row.started_at,
        recorded_seconds=row.recorded_seconds,
        note_count=len(notes),
        important_count=sum(1 for note in notes if note.get("important")),
        has_summary=bool(payload.get("summary")),
        created_at=as_time(row.created_at),
        updated_at=as_time(row.updated_at),
    )


def detail(row: LectureRecord, payload: dict) -> LectureRecordDetail:
    return LectureRecordDetail(
        **item(row, payload).model_dump(),
        instructor=payload.get("instructor", ""),
        extra_info=payload.get("extra_info", ""),
        notes=payload.get("notes", []),
        summary=payload.get("summary"),
        transcript=payload.get("transcript"),
    )


def owned(db: Session, user_id: str, record_id: str) -> LectureRecord:
    row = db.scalar(
        select(LectureRecord).where(LectureRecord.id == record_id, LectureRecord.user_id == user_id)
    )
    if row is None:
        raise AuthError("LECTURE_NOT_FOUND", "课程记录不存在或已被删除。", 404)
    return row


def checked_notes(notes: list[LectureNote], duration: int) -> list[dict]:
    result = []
    for note in sorted(notes, key=lambda value: value.at_seconds):
        text = note.text.strip()
        if not text:
            raise AuthError("LECTURE_INVALID", "笔记内容不能为空。", 400)
        if note.at_seconds > duration + 60:
            raise AuthError("LECTURE_INVALID", "笔记时间超出了课程时长。", 400)
        result.append({"at_seconds": note.at_seconds, "text": text, "important": note.important})
    return result


def checked_transcript(lines: list[TranscriptLine] | None, duration: int) -> list[dict] | None:
    if not lines:
        return None
    result = []
    for line in sorted(lines, key=lambda value: value.at_seconds):
        if line.at_seconds > duration + 60:
            raise AuthError("LECTURE_INVALID", "转写时间超出了课程时长。", 400)
        english = line.en.strip()
        if english:
            chinese = (line.zh or "").strip() or None
            result.append({"at_seconds": round(line.at_seconds, 2), "en": english, "zh": chinese})
    return result or None


def checked_summary(summary: LectureSummary | None, duration: int) -> dict | None:
    if summary is None:
        return None
    if summary.version != SUMMARY_VERSION:
        raise AuthError("LECTURE_INVALID", "摘要版本不受支持，请重新生成。", 400)
    items = [*summary.key_points, *summary.reminders]
    times = [item.at_seconds for item in items]
    times += [quote.at_seconds for item in items for quote in item.quotes]
    if any(value > duration + 60 for value in times):
        raise AuthError("LECTURE_INVALID", "摘要时间超出了课程时长。", 400)
    return summary.model_dump(mode="json")


@router.get("", response_model=LectureRecordList)
def list_records(request: Request, db: Session = Depends(database)) -> LectureRecordList:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    rows = db.scalars(
        select(LectureRecord)
        .where(LectureRecord.user_id == user.id)
        .order_by(LectureRecord.started_at.desc(), LectureRecord.id)
    )
    return LectureRecordList(items=[item(row, read_payload(request, row)) for row in rows])


@router.get("/{record_id}", response_model=LectureRecordDetail)
def get_record(
    record_id: str, request: Request, db: Session = Depends(database)
) -> LectureRecordDetail:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    row = owned(db, user.id, record_id)
    return detail(row, read_payload(request, row))


@router.post("", response_model=LectureRecordDetail, status_code=201)
def create_record(
    body: LectureRecordInput, request: Request, db: Session = Depends(database)
) -> LectureRecordDetail:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    name = clean(body.course_name)
    if not name:
        raise AuthError("LECTURE_INVALID", "请填写课程名称。", 400)
    started, ended = epoch(body.started_at), epoch(body.ended_at)
    duration = ended - started
    if not 0 < duration <= MAX_LECTURE_SECONDS:
        raise AuthError(
            "LECTURE_INVALID", "课程时间无效：结束时间需晚于开始时间且不超过 12 小时。", 400
        )
    if started < int(datetime(2000, 1, 1, tzinfo=UTC).timestamp()) or ended > time.time() + 300:
        raise AuthError("LECTURE_INVALID", "课程时间超出可保存的范围。", 400)
    if body.recorded_seconds > duration:
        raise AuthError("LECTURE_INVALID", "录音时长不能超过课程时长。", 400)
    now = int(time.time())
    row = LectureRecord(
        id=str(uuid4()),
        user_id=user.id,
        course_name=name,
        course_code=clean(body.course_code),
        started_at=started,
        ended_at=ended,
        recorded_seconds=body.recorded_seconds,
        created_at=now,
        updated_at=now,
    )
    payload = {
        "instructor": clean(body.instructor),
        "extra_info": body.extra_info.strip(),
        "notes": checked_notes(body.notes, duration),
        "summary": checked_summary(body.summary, duration),
        "transcript": checked_transcript(body.transcript, duration),
    }
    write_payload(request, row, payload)
    db.add(row)
    db.commit()
    return detail(row, payload)


@router.patch("/{record_id}", response_model=LectureRecordDetail)
def update_record(
    record_id: str, body: LectureRecordUpdate, request: Request, db: Session = Depends(database)
) -> LectureRecordDetail:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    row = owned(db, user.id, record_id)
    payload = read_payload(request, row)
    if body.course_name is not None:
        if not clean(body.course_name):
            raise AuthError("LECTURE_INVALID", "请填写课程名称。", 400)
        row.course_name = clean(body.course_name)
    if body.course_code is not None:
        row.course_code = clean(body.course_code)
    if body.instructor is not None:
        payload["instructor"] = clean(body.instructor)
    if body.extra_info is not None:
        payload["extra_info"] = body.extra_info.strip()
    if body.notes is not None:
        payload["notes"] = checked_notes(body.notes, row.ended_at - row.started_at)
    row.updated_at = int(time.time())
    write_payload(request, row, payload)
    db.commit()
    return detail(row, payload)


@router.delete("/{record_id}", status_code=204)
def delete_record(record_id: str, request: Request, db: Session = Depends(database)) -> Response:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    db.delete(owned(db, user.id, record_id))
    db.commit()
    return Response(status_code=204)


summary_router = APIRouter(
    prefix="/api/v1/lecture-summaries",
    responses={code: {"model": ErrorOutput} for code in (400, 401, 403, 413, 422, 502, 503)},
)


class SummaryLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    at_seconds: float = Field(ge=0, le=MAX_LECTURE_SECONDS)
    en: str = Field(min_length=1, max_length=2000)


class SummaryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lines: list[SummaryLine] = Field(min_length=1, max_length=20000)
    notes: list[LectureNote] = Field(default_factory=list, max_length=500)


SUMMARY_ERRORS = {
    "LECTURE_SUMMARY_TOO_SHORT": ("这节课识别到的讲课内容太少，无法生成摘要。", 400),
    "LECTURE_SUMMARY_BUSY": ("本地模型正忙，请稍后重试。", 503),
    "LECTURE_SUMMARY_TIMEOUT": ("本地模型生成超时，请稍后重试。", 503),
    "LECTURE_SUMMARY_LOCAL_SERVICE_UNAVAILABLE": ("请启动本地 Ollama 并确认模型已下载。", 503),
    "LECTURE_SUMMARY_INPUT_TOO_LONG": ("内容过长，超出本地模型可处理的长度。", 413),
}


@summary_router.post("", response_model=LectureSummary)
def summarize_lecture(
    body: SummaryInput, request: Request, db: Session = Depends(database)
) -> LectureSummary:
    """Generated on request and returned only; saved only if the user saves the record."""
    services.current_user(db, request.cookies.get(SESSION_COOKIE))
    db.rollback()  # No database work is needed during local inference.
    try:
        summary = request.app.state.lecture_summarizer.summarize(
            [Line(line.at_seconds, line.en) for line in body.lines],
            [Note(note.at_seconds, note.text.strip(), note.important) for note in body.notes],
            request_language(request),
        )
    except SummaryError as exc:
        code = str(exc)
        message, status = SUMMARY_ERRORS.get(code, ("本次摘要未通过格式检查，请重新生成。", 502))
        raise AuthError(
            code if code in SUMMARY_ERRORS else "LECTURE_SUMMARY_INVALID", message, status
        ) from None
    return LectureSummary.model_validate(summary)
