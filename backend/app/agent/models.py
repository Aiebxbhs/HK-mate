"""Provider-neutral chat model interface and the OpenAI Chat Completions adapter.

The rest of the agent only sees `ChatModel.complete(messages, tools) -> ModelTurn`, so
another provider is added by writing one adapter. Errors carry fixed codes only: provider
responses can echo user text, so they are never put into messages or logs.
"""

import json
import time
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import httpx

from app.agent.providers import AgentSettings

Role = Literal["system", "user", "assistant", "tool"]
Finish = Literal["stop", "tool_calls", "length", "content_filter"]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict  # JSON schema of the arguments object


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict | None  # None when the model sent arguments that are not a JSON object


@dataclass
class Message:
    role: Role
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)  # assistant only
    tool_call_id: str = ""  # tool only
    # Assistant only: the provider's own output items, replayed as-is on the next call when
    # the API needs them (Responses reasoning items). Other adapters ignore them.
    provider_items: list[dict] = field(default_factory=list)


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass(frozen=True)
class ModelTurn:
    text: str
    tool_calls: list[ToolCall]
    finish: Finish
    usage: Usage
    elapsed_seconds: float
    provider_items: list[dict] = field(default_factory=list)


class ModelError(Exception):
    """Contains a fixed code only."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class ChatModel(Protocol):
    def complete(self, messages: list[Message], tools: list[ToolSpec]) -> ModelTurn: ...


def to_openai_message(message: Message) -> dict[str, Any]:
    if message.role == "tool":
        return {"role": "tool", "tool_call_id": message.tool_call_id, "content": message.content}
    if message.role == "assistant" and message.tool_calls:
        return {
            "role": "assistant",
            "content": message.content or None,
            "tool_calls": [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": json.dumps(call.arguments or {}, ensure_ascii=False),
                    },
                }
                for call in message.tool_calls
            ],
        }
    return {"role": message.role, "content": message.content}


def to_openai_tool(tool: ToolSpec) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        },
    }


def parse_arguments(raw: Any) -> dict | None:
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


FINISH = {"stop": "stop", "tool_calls": "tool_calls", "function_call": "tool_calls"}


def error_code(response: httpx.Response) -> str:
    try:
        error = response.json().get("error") or {}
        detail = f"{error.get('code') or ''} {error.get('type') or ''}"
    except (ValueError, AttributeError):
        detail = ""
    status = response.status_code
    if status == 403 and "unsupported_country" in detail:
        return "AGENT_REGION_UNSUPPORTED"
    if status in (401, 403):
        return "AGENT_AUTH_FAILED"
    if status == 429:
        return "AGENT_QUOTA_EXCEEDED" if "insufficient_quota" in detail else "AGENT_RATE_LIMITED"
    if status == 400 and "context_length" in detail:
        return "AGENT_INPUT_TOO_LONG"
    if status == 404:
        return "AGENT_MODEL_NOT_FOUND"
    if status >= 500:
        return "AGENT_UNAVAILABLE"
    return "AGENT_BAD_REQUEST"


class OpenAIChatModel:
    """OpenAI Chat Completions with function tools; also used for compatible providers."""

    RETRY_CODES = {"AGENT_UNAVAILABLE", "AGENT_RATE_LIMITED"}

    def __init__(
        self,
        settings: AgentSettings,
        client: httpx.Client | None = None,
        retry_delay: float = 1.0,
    ):
        problem = settings.problem()
        if problem:
            raise ModelError(problem)
        self.settings = settings
        self.client = client
        self.retry_delay = retry_delay

    def request_body(self, messages: list[Message], tools: list[ToolSpec]) -> dict[str, Any]:
        preset = self.settings.preset
        body: dict[str, Any] = {
            "model": self.settings.model,
            "messages": [to_openai_message(message) for message in messages],
            preset.max_tokens_field: self.settings.max_output_tokens,
        }
        if tools:
            body["tools"] = [to_openai_tool(tool) for tool in tools]
            body["tool_choice"] = "auto"
        return body

    def complete(self, messages: list[Message], tools: list[ToolSpec]) -> ModelTurn:
        body = self.request_body(messages, tools)
        started = time.monotonic()
        for attempt in range(2):  # one retry for transient failures
            try:
                response = self._post(body)
            except httpx.TimeoutException:
                raise ModelError("AGENT_TIMEOUT") from None
            except httpx.HTTPError:
                code = "AGENT_UNAVAILABLE"
            else:
                if response.status_code == 200:
                    return self._parse(response, started)
                code = error_code(response)
            if code not in self.RETRY_CODES or attempt:
                raise ModelError(code)
            time.sleep(self.retry_delay)
        raise ModelError("AGENT_UNAVAILABLE")  # pragma: no cover

    def _post(self, body: dict[str, Any]) -> httpx.Response:
        url = f"{self.settings.endpoint}/chat/completions"
        headers = {"Authorization": f"Bearer {self.settings.api_key}"}
        if self.client is not None:
            return self.client.post(url, json=body, headers=headers)
        # trust_env: cloud calls may need the user's HTTPS proxy (e.g. outside supported regions).
        with httpx.Client(
            timeout=self.settings.timeout_seconds, follow_redirects=False, trust_env=True
        ) as client:
            return client.post(url, json=body, headers=headers)

    def _parse(self, response: httpx.Response, started: float) -> ModelTurn:
        try:
            data = response.json()
            choice = data["choices"][0]
            message = choice["message"]
            calls = [
                ToolCall(
                    id=str(call["id"]),
                    name=str(call["function"]["name"]),
                    arguments=parse_arguments(call["function"].get("arguments")),
                )
                for call in message.get("tool_calls") or []
            ]
            usage = data.get("usage") or {}
            finish = FINISH.get(choice.get("finish_reason") or "stop", choice.get("finish_reason"))
            if calls:
                finish = "tool_calls"
            if finish not in ("stop", "tool_calls", "length", "content_filter"):
                finish = "stop"
            return ModelTurn(
                text=(message.get("content") or "").strip(),
                tool_calls=calls,
                finish=finish,
                usage=Usage(
                    int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)
                ),
                elapsed_seconds=round(time.monotonic() - started, 2),
            )
        except (ValueError, KeyError, IndexError, TypeError):
            raise ModelError("AGENT_BAD_RESPONSE") from None


class OpenAIResponsesModel(OpenAIChatModel):
    """OpenAI Responses API (`POST /responses`) with function tools.

    `store: false` keeps conversations off OpenAI's stored-response feature; reasoning items
    are requested in encrypted form and replayed with the tool results, as the API expects
    when a reasoning model calls tools without stored state.
    """

    def request_body(self, messages: list[Message], tools: list[ToolSpec]) -> dict[str, Any]:
        instructions = "\n\n".join(m.content for m in messages if m.role == "system")
        body: dict[str, Any] = {
            "model": self.settings.model,
            "input": self.input_items(messages),
            "max_output_tokens": self.settings.max_output_tokens,
            "store": False,
            "include": ["reasoning.encrypted_content"],
        }
        if instructions:
            body["instructions"] = instructions
        if self.settings.reasoning_effort:
            body["reasoning"] = {"effort": self.settings.reasoning_effort}
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                }
                for tool in tools
            ]
            body["tool_choice"] = "auto"
        return body

    @staticmethod
    def input_items(messages: list[Message]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for message in messages:
            if message.role == "system":
                continue
            if message.role == "tool":
                items.append(
                    {
                        "type": "function_call_output",
                        "call_id": message.tool_call_id,
                        "output": message.content,
                    }
                )
            elif message.role == "assistant" and message.provider_items:
                items.extend(message.provider_items)
            elif message.role == "assistant" and message.tool_calls:
                if message.content:
                    items.append({"role": "assistant", "content": message.content})
                items.extend(
                    {
                        "type": "function_call",
                        "call_id": call.id,
                        "name": call.name,
                        "arguments": json.dumps(call.arguments or {}, ensure_ascii=False),
                    }
                    for call in message.tool_calls
                )
            else:
                items.append({"role": message.role, "content": message.content})
        return items

    def _post(self, body: dict[str, Any]) -> httpx.Response:
        url = f"{self.settings.endpoint}/responses"
        headers = {"Authorization": f"Bearer {self.settings.api_key}"}
        if self.client is not None:
            return self.client.post(url, json=body, headers=headers)
        with httpx.Client(
            timeout=self.settings.timeout_seconds, follow_redirects=False, trust_env=True
        ) as client:
            return client.post(url, json=body, headers=headers)

    def _parse(self, response: httpx.Response, started: float) -> ModelTurn:
        try:
            data = response.json()
            output = data["output"]
            texts, calls, replay = [], [], []
            for item in output:
                kind = item.get("type")
                if kind == "message":
                    texts += [
                        part.get("text", "")
                        for part in item.get("content") or []
                        if part.get("type") == "output_text"
                    ]
                elif kind == "function_call":
                    calls.append(
                        ToolCall(
                            id=str(item["call_id"]),
                            name=str(item["name"]),
                            arguments=parse_arguments(item.get("arguments")),
                        )
                    )
                if kind in ("reasoning", "function_call"):
                    replay.append(item)
            finish: Finish = "tool_calls" if calls else "stop"
            if data.get("status") == "incomplete" and not calls:
                reason = (data.get("incomplete_details") or {}).get("reason")
                finish = "content_filter" if reason == "content_filter" else "length"
            usage = data.get("usage") or {}
            return ModelTurn(
                text="".join(texts).strip(),
                tool_calls=calls,
                finish=finish,
                usage=Usage(
                    int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)
                ),
                elapsed_seconds=round(time.monotonic() - started, 2),
                provider_items=replay if calls else [],
            )
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            raise ModelError("AGENT_BAD_RESPONSE") from None


def create_model(settings: AgentSettings, client: httpx.Client | None = None) -> ChatModel:
    preset = settings.preset
    if preset is None:
        raise ModelError("AGENT_UNKNOWN_PROVIDER")
    if preset.api == "openai_responses":
        return OpenAIResponsesModel(settings, client)
    if preset.api == "openai_chat":
        return OpenAIChatModel(settings, client)
    raise ModelError("AGENT_PROVIDER_NOT_IMPLEMENTED")
