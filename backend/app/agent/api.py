"""Home-page assistant endpoints.

`POST /api/v1/agent/chat` streams Server-Sent Events while the agent works:
  step   {"tool", "label", "state": "running" | "done" | "failed"}
  card   a result card for the interface (never sent to the model)
  conversation {"id", "title"}   (saved mode only, sent first)
  answer {"text", "stopped"}
  error  {"code", "message"}
  done   {}
Saved mode (`conversation_id` + `message`): the server keeps the encrypted history, sends the
model a summary of older turns plus the recent ones, and adds what it remembers about the user
(see app/agent/memory.py). Stateless mode (`messages`) stores nothing. Nothing is logged, and
the identity used by tools comes from the session, never from the request body or the model.
"""

import json
import queue
import threading
import time
from collections import defaultdict, deque
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import services
from app.agent import memory
from app.agent.models import Message, ModelError
from app.agent.providers import AgentSettings
from app.agent.runtime import AgentLoop
from app.agent.skills import system_prompt
from app.agent.tools import TOOLS
from app.api import database
from app.core.security import SESSION_COOKIE
from app.i18n import request_language, tr
from app.models import AgentMemory
from app.schemas import ErrorOutput
from app.services import AuthError

router = APIRouter(
    prefix="/api/v1/agent",
    responses={code: {"model": ErrorOutput} for code in (400, 401, 403, 404, 422, 429, 503)},
)

TOOL_LABELS = {
    "get_weather": "正在查看天文台天气",
    "list_schedule": "正在查询你的日程",
    "app_help": "正在查找使用说明",
    "knowledge_search": "正在查阅官方资料整理的指南",
    "draft_email": "正在用本机模型起草邮件",
    "propose_event": "正在准备日程",
    "search_lectures": "正在查找课程记录",
    "search_places": "正在 Google 地图上找",
    "offer_choices": "",
    "remember": "",
}

ERRORS = {
    "AGENT_NOT_CONFIGURED": (
        "AI 助手尚未配置：请在 private-data/agent.env 中填写模型名和当前服务商的 API Key。"
    ),
    "AGENT_UNKNOWN_PROVIDER": "AI 助手配置的服务商不受支持。",
    "AGENT_PROVIDER_NOT_IMPLEMENTED": "所选服务商尚未接入，请换用 OpenAI 或兼容接口的服务商。",
    "AGENT_INSECURE_ENDPOINT": "AI 服务地址必须使用 HTTPS。",
    "AGENT_AUTH_FAILED": "AI 服务的 API Key 无效或没有权限，请检查配置。",
    "AGENT_REGION_UNSUPPORTED": "所选 AI 服务不支持当前所在地区，请换用其他服务商或网络。",
    "AGENT_QUOTA_EXCEEDED": "AI 服务的额度已用完，请检查账户余额。",
    "AGENT_RATE_LIMITED": "AI 服务繁忙，请稍后再试。",
    "AGENT_TIMEOUT": "AI 服务响应超时，请稍后再试。",
    "AGENT_UNAVAILABLE": "暂时无法连接 AI 服务，请检查网络后重试。",
    "AGENT_INPUT_TOO_LONG": "对话太长了，请点“新对话”后再问。",
    "AGENT_MODEL_NOT_FOUND": "配置的模型名称不存在，请检查设置。",
    "AGENT_BAD_REQUEST": "AI 服务拒绝了这次请求，请换个说法再试。",
    "AGENT_BAD_RESPONSE": "AI 服务返回了无法识别的内容，请重试。",
    "AGENT_EMPTY_ANSWER": "AI 没有给出回答，请换个说法再试。",
}


def error_message(code: str, language: str = "zh") -> str:
    return tr(ERRORS.get(code, "AI 助手暂时出错，请稍后再试。"), language)


ENGLISH_PROMPT = (
    "The user has set HK Mate to English. Reply in English unless the user writes in another "
    "language. Tool results may be in Chinese; translate what you use. Keep official English "
    "names as they are."
)


class ChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatInput(BaseModel):
    """Either `messages` (stateless) or `message` with an optional `conversation_id` (saved)."""

    model_config = ConfigDict(extra="forbid")
    messages: list[ChatTurn] | None = Field(default=None, min_length=1, max_length=30)
    conversation_id: str | None = Field(default=None, max_length=36)
    message: str | None = Field(default=None, min_length=1, max_length=4000)
    # Used only by the local drafting model; never sent to the cloud model.
    signature: str = Field(default="", max_length=60)

    @model_validator(mode="after")
    def one_mode(self) -> "ChatInput":
        if (self.messages is None) == (self.message is None):
            raise ValueError("send either messages or message")
        if self.messages is not None and self.conversation_id is not None:
            raise ValueError("conversation_id needs message")
        return self


class ConversationItem(BaseModel):
    id: str
    title: str
    updated_at: datetime


class ConversationList(BaseModel):
    items: list[ConversationItem]


class SavedMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = ""
    cards: list[dict] = Field(default_factory=list)
    error: str = ""


class ConversationDetail(ConversationItem):
    messages: list[SavedMessage]


class MemoryItem(BaseModel):
    id: str
    fact: str
    updated_at: datetime


class MemoryList(BaseModel):
    items: list[MemoryItem]


class AgentStatus(BaseModel):
    available: bool
    provider: str
    provider_label: str
    model: str
    problem: str | None = None
    message: str = ""


class RateLimiter:
    """Per-account limits kept in memory (single backend process)."""

    def __init__(self, per_minute: int = 10, per_day: int = 200):
        self.per_minute, self.per_day = per_minute, per_day
        self.lock = threading.Lock()
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, user_id: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        with self.lock:
            hits = self.hits[user_id]
            while hits and now - hits[0] > 86400:
                hits.popleft()
            recent = sum(1 for moment in hits if now - moment < 60)
            if recent >= self.per_minute or len(hits) >= self.per_day:
                return False
            hits.append(now)
            return True


def settings_of(request: Request) -> AgentSettings:
    return request.app.state.agent_settings


@router.get("/status", response_model=AgentStatus)
def status(request: Request, db: Session = Depends(database)) -> AgentStatus:
    services.current_user(db, request.cookies.get(SESSION_COOKIE))
    language = request_language(request)
    settings = settings_of(request)
    problem = settings.problem()
    preset = settings.preset
    return AgentStatus(
        available=problem is None,
        provider=settings.provider,
        provider_label=tr(preset.label, language) if preset else settings.provider,
        model=settings.model,
        problem=problem,
        message=error_message(problem, language) if problem else "",
    )


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat")
def chat(body: ChatInput, request: Request, db: Session = Depends(database)) -> StreamingResponse:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    language = request_language(request)
    app = request.app
    vault = app.state.mail.vault
    if body.messages is not None:
        if body.messages[-1].role != "user":
            raise AuthError("AGENT_INVALID", "最后一条消息应来自用户。", 400)
        if sum(len(turn.content) for turn in body.messages) > 24000:
            raise AuthError("AGENT_INPUT_TOO_LONG", error_message("AGENT_INPUT_TOO_LONG"), 400)
    elif body.conversation_id is not None and not memory.owned_conversation(
        db, vault, user.id, body.conversation_id
    ):
        raise AuthError("AGENT_CONVERSATION_NOT_FOUND", "这个对话不存在或已被删除。", 404)
    problem = settings_of(request).problem()
    if problem:
        raise AuthError(problem, error_message(problem), 503)
    if not app.state.agent_limiter.allow(user.id):
        raise AuthError("AGENT_TOO_MANY_REQUESTS", "提问太频繁了，请稍等一会儿再试。", 429)

    remembered = memory.list_memories(db, vault, user.id)
    conversation = None
    if body.message is not None:
        if body.conversation_id is None:
            row, payload = memory.create_conversation(db, vault, user.id, body.message)
        else:
            row, payload = memory.owned_conversation(db, vault, user.id, body.conversation_id)
        payload["messages"].append({"role": "user", "content": body.message.strip()})
        memory.save_conversation(db, vault, row, payload)
        db.commit()
        conversation = {"id": row.id, "title": payload["title"]}
        history = memory.model_history(payload)
    else:
        db.rollback()
        history = [Message(turn.role, turn.content) for turn in body.messages]
    messages = [
        Message("system", system_prompt(datetime.now(UTC))),
        Message("system", memory.memory_prompt(remembered)),
        *([Message("system", ENGLISH_PROMPT)] if language == "en" else []),
        *history,
    ]
    context = {
        "user_id": user.id,
        "language": language,
        "session_factory": app.state.session_factory,
        "weather": app.state.weather,
        "drafter": app.state.reply_drafter,
        "model_lock": app.state.summary_lock,
        "vault": vault,
        "signature": body.signature.strip(),
        "places_key": app.state.google_maps_key,
        "places_limit": app.state.places_limit,
        "places_client": getattr(app.state, "places_client", None),
    }
    events: queue.Queue[str | None] = queue.Queue()
    if conversation:
        events.put(sse("conversation", conversation))

    def step(name: str, state: str) -> None:
        label = TOOL_LABELS.get(name, name)
        if label:  # interface-only tools (quick replies, memory) are not shown as steps
            events.put(sse("step", {"tool": name, "label": tr(label, language), "state": state}))

    def record(reply: dict) -> None:
        """Saves the assistant reply, then tidies history and memory after the answer."""
        if conversation is None:
            return
        with app.state.session_factory() as session:
            found = memory.owned_conversation(session, vault, user.id, conversation["id"])
            if found is None:  # deleted meanwhile
                return
            row, payload = found
            payload["messages"].append(reply)
            memory.save_conversation(session, vault, row, payload)
            session.commit()

    def tidy(model) -> None:
        with app.state.session_factory() as session:
            if conversation is not None:
                found = memory.owned_conversation(session, vault, user.id, conversation["id"])
                if found and memory.needs_summary(found[1]):
                    try:
                        memory.save_conversation(
                            session, vault, found[0], memory.summarize(model, found[1])
                        )
                    except ModelError:
                        pass  # try again after the next answer
            if context.get("merge_memories"):
                memory.merge_memories(session, vault, user.id, model)
            session.commit()

    def work() -> None:
        model = None
        try:
            model = app.state.agent_model_factory()
            loop = AgentLoop(model, TOOLS)
            result = loop.run(
                messages,
                context,
                on_tool_start=lambda name: step(name, "running"),
                on_step=lambda done: step(done.name, "done" if done.ok else "failed"),
            )
            for card in result.cards:
                events.put(sse("card", card))
            events.put(sse("answer", {"text": result.text, "stopped": result.stopped}))
            record(
                {
                    "role": "assistant",
                    "content": result.text,
                    "cards": memory.stored_cards(result.cards),
                }
            )
        except ModelError as exc:
            message = error_message(exc.code, language)
            events.put(sse("error", {"code": exc.code, "message": message}))
            record({"role": "assistant", "content": "", "error": message})
        except Exception:  # noqa: BLE001 - report a fixed message, never internals
            message = error_message("", language)
            events.put(sse("error", {"code": "AGENT_FAILED", "message": message}))
            record({"role": "assistant", "content": "", "error": message})
        finally:
            events.put(sse("done", {}))
            events.put(None)
        if model is not None:
            try:
                tidy(model)
            except Exception:  # noqa: BLE001 - housekeeping must never break a reply
                pass

    threading.Thread(target=work, daemon=True).start()

    def stream() -> Iterator[str]:
        while (item := events.get()) is not None:
            yield item

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/conversations", response_model=ConversationList)
def conversations(request: Request, db: Session = Depends(database)) -> ConversationList:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    vault = request.app.state.mail.vault
    return ConversationList(items=memory.list_conversations(db, vault, user.id))


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def conversation_detail(
    conversation_id: str, request: Request, db: Session = Depends(database)
) -> ConversationDetail:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    found = memory.owned_conversation(db, request.app.state.mail.vault, user.id, conversation_id)
    if found is None:
        raise AuthError("AGENT_CONVERSATION_NOT_FOUND", "这个对话不存在或已被删除。", 404)
    row, payload = found
    return ConversationDetail(
        id=row.id,
        title=payload["title"],
        updated_at=datetime.fromtimestamp(row.updated_at, UTC),
        messages=payload["messages"],
    )


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: str, request: Request, db: Session = Depends(database)
) -> Response:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    found = memory.owned_conversation(db, request.app.state.mail.vault, user.id, conversation_id)
    if found is None:
        raise AuthError("AGENT_CONVERSATION_NOT_FOUND", "这个对话不存在或已被删除。", 404)
    db.delete(found[0])
    db.commit()
    return Response(status_code=204)


@router.get("/memories", response_model=MemoryList)
def memories(request: Request, db: Session = Depends(database)) -> MemoryList:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    return MemoryList(items=memory.list_memories(db, request.app.state.mail.vault, user.id))


@router.delete("/memories/{memory_id}", status_code=204)
def forget(memory_id: str, request: Request, db: Session = Depends(database)) -> Response:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    row = db.scalar(
        select(AgentMemory).where(AgentMemory.id == memory_id, AgentMemory.user_id == user.id)
    )
    if row is None:
        raise AuthError("AGENT_MEMORY_NOT_FOUND", "这条记忆不存在或已被删除。", 404)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.delete("/memories", status_code=204)
def forget_all(request: Request, db: Session = Depends(database)) -> Response:
    user = services.current_user(db, request.cookies.get(SESSION_COOKIE))
    db.execute(delete(AgentMemory).where(AgentMemory.user_id == user.id))
    db.commit()
    return Response(status_code=204)
