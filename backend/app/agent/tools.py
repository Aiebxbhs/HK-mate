"""Assistant tools: weather, schedule, in-app help, email drafts, event proposals and
course records.

Every tool gets the signed-in user's id from `context` (set by the API from the session),
never from the model. Results for the model are short and omit fields a question does not
need (for example event descriptions). Nothing here sends email or writes data: an email
draft is written by the local Qwen model and shown in a card; a new schedule item is only
proposed in a card and saved when the user confirms it through the normal calendar API.
"""

import json
import re
from datetime import date, datetime, time, timedelta
from datetime import date as Day  # a field below is called "date"
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.agent.memory import MEMORY_TOOLS
from app.agent.places import PLACE_TOOLS
from app.agent.runtime import Tool, ToolResult
from app.calendar_service import HONG_KONG, course_name_from_description, events_between
from app.mail_reply import ComposeRequest, DraftError
from app.models import LectureRecord

GUIDE = Path(__file__).with_name("knowledge") / "app_guide.md"
MAX_EVENTS_FOR_MODEL = 60


class NoArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")


def get_weather(arguments: NoArguments, context: dict) -> ToolResult:
    weather = context["weather"].get()
    if weather.status == "unavailable":
        return ToolResult({"status": "unavailable", "note": "Weather data is unavailable now."})
    return ToolResult(
        {
            "status": weather.status,  # "stale" means older cached data
            "temperature_c": weather.temperature,
            "humidity_percent": weather.humidity,
            "observed_at": weather.observed_at.isoformat() if weather.observed_at else None,
            "forecast": weather.forecast,
            "warnings_in_force": weather.warnings,
            "source": "Hong Kong Observatory",
        }
    )


class ScheduleQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_date: date = Field(description="First day, YYYY-MM-DD, Hong Kong time.")
    days: int = Field(default=1, ge=1, le=31, description="Number of days to include.")
    include_completed: bool = Field(
        default=False, description="Also list items the user marked as done."
    )


def hk_time(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, HONG_KONG).strftime("%Y-%m-%d %H:%M")


def list_schedule(arguments: ScheduleQuery, context: dict) -> ToolResult:
    end = arguments.start_date + timedelta(days=arguments.days)
    with context["session_factory"]() as db:
        rows = events_between(db, context["user_id"], arguments.start_date, end)
    items = []
    for row in rows:
        if row.completed_at is not None and not arguments.include_completed:
            continue
        deadline = row.kind == "deadline"
        course = (
            course_name_from_description(row.title, row.description) if row.source == "hku" else ""
        )
        items.append(
            {
                "title": row.title,
                "course_name": course,
                "type": "deadline" if deadline else ("class" if row.source == "hku" else "event"),
                "starts": hk_time(row.starts_at),
                "ends": None if deadline else hk_time(row.ends_at),
                "location": row.location,
                "done": row.completed_at is not None,
            }
        )
    shown = items[:MAX_EVENTS_FOR_MODEL]
    return ToolResult(
        {
            "range": f"{arguments.start_date} to {end - timedelta(days=1)} (Hong Kong time)",
            "count": len(items),
            "items": shown,
            "truncated": len(items) > len(shown),
        },
        card={
            "type": "schedule",
            "start_date": arguments.start_date.isoformat(),
            "days": arguments.days,
            "items": shown,
        },
    )


def english_version(path: Path, language: str) -> Path:
    """English translations live in an `en` folder beside the original, with the same name."""
    english = path.parent / "en" / path.name
    return english if language == "en" and english.is_file() else path


def guide_sections(language: str = "zh") -> list[tuple[str, str]]:
    text = english_version(GUIDE, language).read_text(encoding="utf-8").split("---", 2)[-1]
    sections = []
    for block in re.split(r"^## ", text, flags=re.MULTILINE)[1:]:
        title, _, body = block.partition("\n")
        sections.append((title.strip(), " ".join(body.split())))
    return sections


def terms(text: str) -> set[str]:
    """Lower-case words plus Chinese character pairs, for simple overlap scoring."""
    text = text.lower()
    words = set(re.findall(r"[a-z0-9]+", text))
    for run in re.findall(r"[一-鿿]+", text):
        words.update(run[i : i + 2] for i in range(max(1, len(run) - 1)))
    return words


KNOWLEDGE_DIR = Path(__file__).with_name("knowledge") / "hk"
# Everyday words students use for the same things as the guides.
ALIASES = {
    "徒步": "行山",
    "爬山": "行山",
    "登山": "行山",
    "hiking": "行山",
    "hike": "行山",
    "visa": "签证",
    "地铁": "港铁",
    "公交卡": "八达通",
    "交通卡": "八达通",
    "银行卡": "银行账户 开户",
    "手机卡": "电话卡",
    "手机号": "电话卡",
    "sim": "电话卡",
    "逛街": "购物",
    "买东西": "购物",
    "身份证": "身份证 HKID",
    "id": "身份证",
    "诈骗": "防骗 诈骗",
    "骗子": "防骗 诈骗",
}


def frontmatter(text: str) -> tuple[dict, list[tuple[str, str]], str]:
    _, header, body = text.split("---", 2)
    fields, sources = {}, []
    for line in header.strip().splitlines():
        key, _, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if key == "source":
            label, _, url = value.partition(" | ")
            sources.append((label.strip(), url.strip()))
        else:
            fields[key] = value
    return fields, sources, body


def load_knowledge(language: str = "zh") -> list[dict]:
    documents = []
    for original in sorted(KNOWLEDGE_DIR.glob("*.md")):
        path = english_version(original, language)
        fields, sources, body = frontmatter(path.read_text(encoding="utf-8"))
        for block in re.split(r"^## ", body, flags=re.MULTILINE)[1:]:
            heading, _, text = block.partition("\n")
            documents.append(
                {
                    "document": fields["title"],
                    "topic": fields["topic"],
                    "verified": fields["verified"],
                    "sources": sources,
                    "section": heading.strip(),
                    "text": " ".join(text.split()),
                }
            )
    return documents


def expand(query: str) -> str:
    lowered = query.lower()
    extra = [value for key, value in ALIASES.items() if key in lowered]
    return " ".join([query, *extra])


class KnowledgeQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(
        min_length=1,
        max_length=200,
        description="What the user wants to know; key terms in Chinese (and English if useful).",
    )
    topic: Literal["newcomer", "explore", "hku", "any"] = Field(
        default="any",
        description="newcomer: HKID, student visa, bank, Octopus/MTR, SIM card, scams; "
        "explore: hiking, shopping; hku: HKU guide for postgraduates (libraries so far).",
    )


def knowledge_search(arguments: KnowledgeQuery, context: dict) -> ToolResult:
    """Returns whole guides (they are short), so no step or document list is cut off: the
    best match, plus a second guide when it scores almost as well."""
    wanted = terms(expand(arguments.query))
    scores: dict[str, int] = {}
    sections: dict[str, list[dict]] = {}
    for item in load_knowledge(context.get("language", "zh")):
        if arguments.topic != "any" and item["topic"] != arguments.topic:
            continue
        sections.setdefault(item["document"], []).append(item)
        score = (
            len(wanted & terms(item["document"])) * 2
            + len(wanted & terms(item["section"])) * 3
            + len(wanted & terms(item["text"]))
        )
        scores[item["document"]] = max(scores.get(item["document"], 0), score)
    ranked = sorted((s, d) for d, s in scores.items() if s > 0)[::-1]
    if not ranked:
        return ToolResult(
            {
                "sections": [],
                "note": "Not covered by the verified guides. Say you are not sure and point "
                "to the relevant official website; do not answer from memory.",
            }
        )
    chosen = [ranked[0][1]] + [d for s, d in ranked[1:2] if s >= ranked[0][0] * 0.8]
    best = [item for document in chosen for item in sections[document]]
    sources: dict[str, str] = {}
    for item in best:
        for label, url in item["sources"]:
            sources.setdefault(url, label)
    verified = max(item["verified"] for item in best)
    return ToolResult(
        {
            "sections": [
                {"guide": i["document"], "section": i["section"], "text": i["text"]} for i in best
            ],
            "sources": list(sources.values()),
            "verified": verified,
        },
        card={
            "type": "knowledge",
            "guides": chosen,
            "verified": verified,
            "sources": [{"label": label, "url": url} for url, label in sources.items()],
        },
    )


class HelpQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=300, description="What the user wants to do.")


def app_help(arguments: HelpQuery, context: dict) -> ToolResult:
    wanted = terms(arguments.question)
    scored = []
    for title, body in guide_sections(context.get("language", "zh")):
        score = len(wanted & terms(title)) * 3 + len(wanted & terms(body))
        scored.append((score, title, body))
    scored.sort(key=lambda item: -item[0])
    best = [{"section": title, "text": body} for score, title, body in scored[:3] if score > 0]
    return ToolResult({"sections": best} if best else {"sections": [], "note": "No match."})


EMAIL_ADDRESS = re.compile(r"[^\s@<>]+@[^\s@<>]+")
DRAFT_ERRORS = {
    "REPLY_LOCAL_SERVICE_UNAVAILABLE": "The local drafting model (Ollama) is not running.",
    "REPLY_TIMEOUT": "The local drafting model timed out.",
    "REPLY_INPUT_TOO_LONG": "The points are too long for the local drafting model.",
}


class EmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    purpose: str = Field(
        min_length=1,
        max_length=1000,
        description=(
            "Everything the email must say, as concrete points in the user's words: the "
            "reason, course code and name, dates and times from the schedule, what the user "
            "asks for or offers. Do not invent facts, excuses or documents."
        ),
    )
    recipient_name: str = Field(
        default="",
        max_length=100,
        description="How to address the recipient, e.g. 'Prof. Chan'. Never an email address.",
    )
    tone: Literal["formal", "friendly"] = "formal"
    language: Literal["auto", "zh", "en"] = Field(
        default="en", description="Language of the email; English for HKU staff unless asked."
    )


def draft_email(arguments: EmailRequest, context: dict) -> ToolResult:
    # The address is filled in by the user in the card; keep any address out of the draft.
    recipient = EMAIL_ADDRESS.sub("", arguments.recipient_name).strip()
    lock = context["model_lock"]
    if not lock.acquire(timeout=90):
        return ToolResult(
            {"error": "The local drafting model is busy (for example live lecture captions)."}
        )
    try:
        draft = context["drafter"].compose(
            ComposeRequest(
                purpose=arguments.purpose.strip(),
                recipient=recipient,
                tone=arguments.tone,
                language=arguments.language,
                signature=context.get("signature", ""),
                interface=context.get("language", "zh"),
            )
        )
    except DraftError as exc:
        return ToolResult({"error": DRAFT_ERRORS.get(str(exc), "Drafting failed; try again.")})
    finally:
        lock.release()
    return ToolResult(
        {
            "status": "draft_shown_to_user",
            "subject": draft.subject,
            "to_check": draft.missing_info,
            "note": (
                "The full draft is shown to the user in an editable card. Do not repeat or "
                "rewrite it. Briefly tell the user to check it and fill in the recipient's "
                "email address in the card; HK Mate never sends email."
            ),
        },
        card={
            "type": "email_draft",
            "recipient_name": recipient,
            "subject": draft.subject,
            "body": draft.body,
            "missing_info": draft.missing_info,
        },
    )


class EventProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["event", "deadline"] = Field(
        default="event",
        description="'deadline' for a due time, 'event' for something with a duration.",
    )
    title: str = Field(min_length=1, max_length=200)
    date: Day = Field(description="YYYY-MM-DD, Hong Kong time.")
    start_time: time = Field(description="HH:MM; for a deadline, the due time.")
    end_time: time | None = Field(default=None, description="HH:MM, same day; events only.")
    location: str = Field(default="", max_length=200)


def propose_event(arguments: EventProposal, context: dict) -> ToolResult:
    deadline = arguments.kind == "deadline"
    end = None if deadline else arguments.end_time
    if not deadline and (end is None or end <= arguments.start_time):
        return ToolResult({"error": "An event needs an end_time later than start_time."})
    proposal = {
        "kind": arguments.kind,
        "title": " ".join(arguments.title.split()),
        "date": arguments.date.isoformat(),
        "start_time": arguments.start_time.strftime("%H:%M"),
        "end_time": end.strftime("%H:%M") if end else None,
        "location": " ".join(arguments.location.split()),
    }
    return ToolResult(
        {
            "status": "waiting_for_user_confirmation",
            "proposal": proposal,
            "note": "Not added yet. The user must press the confirm button in the card.",
        },
        card={"type": "event_proposal", **proposal},
    )


class LectureQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course: str = Field(default="", max_length=100, description="Part of the course name.")
    date_from: date | None = Field(default=None, description="YYYY-MM-DD, Hong Kong time.")
    date_to: date | None = Field(default=None, description="YYYY-MM-DD inclusive.")
    limit: int = Field(default=3, ge=1, le=5)


def clock(seconds: float) -> str:
    seconds = int(seconds)
    return f"{seconds // 3600}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def search_lectures(arguments: LectureQuery, context: dict) -> ToolResult:
    query = select(LectureRecord).where(LectureRecord.user_id == context["user_id"])
    if arguments.date_from:
        start = datetime.combine(arguments.date_from, time.min, HONG_KONG)
        query = query.where(LectureRecord.started_at >= int(start.timestamp()))
    if arguments.date_to:
        end = datetime.combine(arguments.date_to + timedelta(days=1), time.min, HONG_KONG)
        query = query.where(LectureRecord.started_at < int(end.timestamp()))
    with context["session_factory"]() as db:
        rows = list(db.scalars(query.order_by(LectureRecord.started_at.desc())))
    wanted = arguments.course.strip().lower()
    rows = [row for row in rows if wanted in row.course_name.lower()][: arguments.limit]
    found, cards = [], []
    for row in rows:
        payload = json.loads(context["vault"].decrypt(row.encrypted_payload))
        summary = payload.get("summary") or {}
        started = datetime.fromtimestamp(row.started_at, HONG_KONG)
        found.append(
            {
                "course_name": row.course_name,
                "date": started.strftime("%Y-%m-%d %H:%M"),
                "duration_minutes": (row.ended_at - row.started_at) // 60,
                "overview": summary.get("overview", ""),
                "key_points": [
                    f"[{clock(item['at_seconds'])}] {item['text']}"
                    for item in summary.get("key_points", [])
                ],
                "reminders": [
                    f"{item['kind']}: {item['text']}" for item in summary.get("reminders", [])
                ],
                "important_notes": [
                    note["text"][:300] for note in payload.get("notes", []) if note.get("important")
                ][:10],
                "has_summary": bool(summary),
            }
        )
        cards.append(
            {
                "id": row.id,
                "course_name": row.course_name,
                "date": started.strftime("%Y-%m-%d"),
                "has_summary": bool(summary),
            }
        )
    return ToolResult(
        {"records": found, "count": len(found)},
        card={"type": "lectures", "items": cards} if cards else None,
    )


TOOLS = [
    Tool(
        "get_weather",
        "Current Hong Kong weather from the Hong Kong Observatory: temperature, humidity, "
        "today's forecast and warnings in force (rainstorm, typhoon, heat, thunderstorm).",
        NoArguments,
        get_weather,
    ),
    Tool(
        "list_schedule",
        "The signed-in user's classes, events and deadlines for a date range in Hong Kong "
        "time. Use for questions such as 'what classes do I have tomorrow' or 'deadlines this "
        "week'.",
        ScheduleQuery,
        list_schedule,
    ),
    Tool(
        "app_help",
        "Search the HK Mate user guide: menus, Gmail connection, inbox, email summaries and "
        "drafts, schedule, lecture translation, course records, privacy.",
        HelpQuery,
        app_help,
    ),
    Tool(
        "knowledge_search",
        "Search HK Mate's verified guides, written from official sources, for newcomers to "
        "Hong Kong (HKID, student visa extension, bank account, Octopus and MTR student fares, "
        "SIM card registration, scams), for outings (beginner hiking routes and safety, "
        "shopping streets and markets) and the HKU guide for postgraduates (libraries: "
        "branches, opening hours, borrowing, room booking, printing). Returns sections with "
        "their official sources.",
        KnowledgeQuery,
        knowledge_search,
    ),
    Tool(
        "draft_email",
        "Write a new email draft for the user with the local drafting model, from points you "
        "provide. The draft is shown to the user in an editable card; nothing is sent. Use "
        "after you have the facts (e.g. which class, from list_schedule).",
        EmailRequest,
        draft_email,
    ),
    Tool(
        "propose_event",
        "Propose adding one item to the user's schedule. It is shown as a card and only "
        "added if the user presses confirm.",
        EventProposal,
        propose_event,
    ),
    *PLACE_TOOLS,
    *MEMORY_TOOLS,
    Tool(
        "search_lectures",
        "Search the user's saved course records (AI summary, key points, reminders, important "
        "notes) by course name and date.",
        LectureQuery,
        search_lectures,
    ),
]
