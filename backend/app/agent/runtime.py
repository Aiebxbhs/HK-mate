"""The tool-calling loop: model -> tools -> model, with hard limits.

Tools are plain functions with a Pydantic argument model. Arguments come from the model and
are untrusted: they are validated before a tool runs, and a tool never receives the user's
identity from the model (tools get it from the caller through `context`). A tool returns a
short result for the model and, optionally, a card for the interface; private details can stay
in the card only. Write actions are not tools that act: they return a card the user confirms.
"""

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ValidationError

from app.agent.models import ChatModel, Message, ModelError, ToolSpec, Usage

MAX_STEPS = 6
MAX_TOOL_RESULT_CHARS = 6000


@dataclass
class ToolResult:
    for_model: Any  # JSON-serialisable, kept short
    card: dict | None = None  # shown in the chat; never sent to the model


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    arguments: type[BaseModel]
    run: Callable[[BaseModel, dict], ToolResult]  # (validated arguments, context)

    @property
    def spec(self) -> ToolSpec:
        schema = self.arguments.model_json_schema()
        schema.pop("title", None)
        return ToolSpec(self.name, self.description, schema)


@dataclass
class ToolStep:
    name: str
    ok: bool
    error: str = ""
    elapsed_seconds: float = 0


@dataclass
class AgentResult:
    text: str
    cards: list[dict] = field(default_factory=list)
    steps: list[ToolStep] = field(default_factory=list)
    stopped: str = "answered"  # answered | max_steps | length | content_filter
    usage: Usage = field(default_factory=Usage)


def tool_message(call_id: str, payload: Any) -> Message:
    text = json.dumps(payload, ensure_ascii=False, default=str)
    if len(text) > MAX_TOOL_RESULT_CHARS:
        text = text[:MAX_TOOL_RESULT_CHARS] + "…(truncated)"
    return Message("tool", text, tool_call_id=call_id)


class AgentLoop:
    def __init__(self, model: ChatModel, tools: list[Tool], max_steps: int = MAX_STEPS):
        self.model = model
        self.tools = {tool.name: tool for tool in tools}
        self.max_steps = max_steps

    def run(
        self,
        messages: list[Message],
        context: dict,
        on_step: Callable[[ToolStep], None] | None = None,
        on_tool_start: Callable[[str], None] | None = None,
    ) -> AgentResult:
        """Raises ModelError from the model; tool failures are reported back to the model."""
        history = list(messages)
        specs = [tool.spec for tool in self.tools.values()]
        result = AgentResult(text="")
        input_tokens = output_tokens = 0
        for step in range(self.max_steps):
            # On the last step the model must answer with what it has.
            turn = self.model.complete(history, specs if step < self.max_steps - 1 else [])
            input_tokens += turn.usage.input_tokens
            output_tokens += turn.usage.output_tokens
            result.usage = Usage(input_tokens, output_tokens)
            if not turn.tool_calls:
                result.text = turn.text
                if turn.finish in ("length", "content_filter"):
                    result.stopped = turn.finish
                if not result.text and turn.finish == "stop":
                    raise ModelError("AGENT_EMPTY_ANSWER")
                return result
            history.append(
                Message(
                    "assistant",
                    turn.text,
                    tool_calls=turn.tool_calls,
                    provider_items=turn.provider_items,
                )
            )
            for call in turn.tool_calls:
                if on_tool_start:
                    on_tool_start(call.name)
                outcome = self._call(call.name, call.arguments, context)
                result.steps.append(outcome[0])
                if on_step:
                    on_step(outcome[0])
                if outcome[1].card is not None:
                    result.cards.append(outcome[1].card)
                history.append(tool_message(call.id, outcome[1].for_model))
        result.stopped = "max_steps"
        return result

    def _call(
        self, name: str, arguments: dict | None, context: dict
    ) -> tuple[ToolStep, ToolResult]:
        started = time.monotonic()
        tool = self.tools.get(name)
        if tool is None:
            return ToolStep(name, False, "unknown_tool"), ToolResult(
                {"error": f"Unknown tool {name!r}. Use only the tools provided."}
            )
        if arguments is None:
            return ToolStep(name, False, "invalid_arguments"), ToolResult(
                {"error": "Arguments must be a JSON object."}
            )
        try:
            parsed = tool.arguments.model_validate(arguments)
        except ValidationError as exc:
            # Field names and messages only, no input values.
            problems = [
                f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
                for error in exc.errors(include_input=False)
            ][:5]
            return ToolStep(name, False, "invalid_arguments"), ToolResult(
                {"error": "Invalid arguments.", "problems": problems}
            )
        try:
            output = tool.run(parsed, context)
        except Exception:  # noqa: BLE001 - a broken tool must not end the conversation
            return ToolStep(name, False, "tool_failed", time.monotonic() - started), ToolResult(
                {"error": "The tool failed. Tell the user it is temporarily unavailable."}
            )
        return ToolStep(name, True, elapsed_seconds=round(time.monotonic() - started, 2)), output
