"""Checks the configured cloud model: key, region, and a full tool-call round trip.

Sends only a synthetic arithmetic question (no account, mail, schedule or lecture data) to
the provider set in HKM_AGENT_PROVIDER / HKM_AGENT_MODEL / HKM_AGENT_API_KEY. Prints the
outcome, latency and token counts; never prints the key. Each run is a billed API call.

    export HKM_AGENT_PROVIDER=openai HKM_AGENT_MODEL=<model id> HKM_AGENT_API_KEY=<key>
    .venv/bin/python scripts/agent-model-check.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.agent.models import Message, ModelError, create_model  # noqa: E402
from app.agent.providers import PROVIDERS, AgentSettings  # noqa: E402
from app.agent.runtime import AgentLoop, Tool, ToolResult  # noqa: E402
from pydantic import BaseModel  # noqa: E402


class Multiply(BaseModel):
    a: int
    b: int


def main() -> None:
    settings = AgentSettings.from_env()
    preset = PROVIDERS.get(settings.provider)
    label = preset.label if preset else settings.provider
    print(f"provider: {label} | model: {settings.model or '(not set)'} | {settings.endpoint}")
    if problem := settings.problem():
        sys.exit(
            f"not ready: {problem} "
            "(set HKM_AGENT_PROVIDER, HKM_AGENT_MODEL and that provider's key)"
        )

    used = []

    def multiply(arguments: Multiply, context: dict) -> ToolResult:
        used.append((arguments.a, arguments.b))
        return ToolResult({"result": arguments.a * arguments.b})

    loop = AgentLoop(
        create_model(settings),
        [Tool("multiply", "Multiply two integers exactly.", Multiply, multiply)],
        max_steps=3,
    )
    try:
        result = loop.run(
            [
                Message("system", "Use the multiply tool for arithmetic. Answer in one sentence."),
                Message("user", "What is 1234 times 5678? Use the tool."),
            ],
            {},
        )
    except ModelError as exc:
        sys.exit(f"FAILED: {exc.code}")
    expected = 1234 * 5678
    ok = used == [(1234, 5678)] and f"{expected:,}".replace(",", "") in result.text.replace(",", "")
    print(f"tool calls: {used} | answer: {result.text}")
    print(f"tokens in/out: {result.usage.input_tokens}/{result.usage.output_tokens}")
    print("PASS: tool calling works" if ok else "CHECK: the model did not use the tool as expected")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
