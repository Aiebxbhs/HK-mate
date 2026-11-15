"""Cloud model providers and how this app reaches them.

Most providers, including the main mainland-China ones, offer an OpenAI-compatible
Chat Completions endpoint, so one adapter covers them; only the base URL, the key and a few
request details differ. Base URLs follow each provider's public documentation and must be
re-checked against it before a provider is switched on. Only "ready" providers have been
built and tested against the OpenAI format with mocked responses; "compatible" ones share
that adapter but have not been tried with a real key; "planned" ones need their own adapter.
"""

import os
from dataclasses import dataclass, field
from typing import Literal

Region = Literal["global", "mainland"]
ApiStyle = Literal["openai_responses", "openai_chat", "anthropic_messages"]
IMPLEMENTED_APIS = ("openai_responses", "openai_chat")
Status = Literal["ready", "compatible", "planned"]


@dataclass(frozen=True)
class ProviderPreset:
    name: str
    label: str
    region: Region
    api: ApiStyle
    base_url: str
    status: Status
    # OpenAI's newer models take max_completion_tokens; most compatible APIs take max_tokens.
    max_tokens_field: str = "max_tokens"
    note: str = ""


PROVIDERS: dict[str, ProviderPreset] = {
    preset.name: preset
    for preset in (
        ProviderPreset(
            "openai",
            "OpenAI（ChatGPT）",
            "global",
            # Newer OpenAI models (e.g. GPT-6.1 Terra) only call tools through Responses.
            "openai_responses",
            "https://api.openai.com/v1",
            "ready",
            max_tokens_field="max_completion_tokens",
            note="Not available in every region (including Hong Kong); check before relying on it.",
        ),
        ProviderPreset(
            "gemini",
            "Google Gemini",
            "global",
            "openai_chat",
            "https://generativelanguage.googleapis.com/v1beta/openai",
            "compatible",
        ),
        ProviderPreset(
            "anthropic",
            "Anthropic Claude",
            "global",
            "anthropic_messages",
            "https://api.anthropic.com/v1",
            "planned",
            note="Native Messages API; needs its own adapter.",
        ),
        ProviderPreset(
            "qwen_intl",
            "通义千问（阿里云国际）",
            "global",
            "openai_chat",
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            "compatible",
        ),
        ProviderPreset(
            "qwen",
            "通义千问（阿里云百炼）",
            "mainland",
            "openai_chat",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "compatible",
        ),
        ProviderPreset(
            "deepseek",
            "DeepSeek",
            "mainland",
            "openai_chat",
            "https://api.deepseek.com/v1",
            "compatible",
        ),
        ProviderPreset(
            "moonshot",
            "Kimi（月之暗面）",
            "mainland",
            "openai_chat",
            "https://api.moonshot.cn/v1",
            "compatible",
        ),
        ProviderPreset(
            "zhipu",
            "智谱 GLM",
            "mainland",
            "openai_chat",
            "https://open.bigmodel.cn/api/paas/v4",
            "compatible",
        ),
        ProviderPreset(
            "custom",
            "其他 OpenAI 兼容服务",
            "global",
            "openai_chat",
            "",
            "compatible",
            note="Set HKM_AGENT_BASE_URL.",
        ),
    )
}


def key_variable(provider: str) -> str:
    """Each provider can keep its own key, e.g. HKM_AGENT_DEEPSEEK_API_KEY."""
    return f"HKM_AGENT_{provider.upper()}_API_KEY"


def provider_key(provider: str) -> str:
    """HKM_AGENT_API_KEY wins when set; otherwise the selected provider's own key."""
    shared = os.environ.get("HKM_AGENT_API_KEY", "").strip()
    return shared or os.environ.get(key_variable(provider), "").strip()


def google_maps_key() -> str:
    """One Google Maps Platform key for Places and any later Maps APIs (not Gmail)."""
    return os.environ.get("HKM_AGENT_GOOGLE_MAPS_API_KEY", "").strip()


@dataclass(frozen=True)
class AgentSettings:
    """Read from the environment; the key is never logged, returned or stored."""

    provider: str = "openai"
    model: str = ""
    api_key: str = field(default="", repr=False)
    base_url: str = ""
    timeout_seconds: float = 60
    # Responses counts reasoning tokens as output, so leave room beyond the visible answer.
    max_output_tokens: int = 4000
    reasoning_effort: str = "low"  # Responses only; empty string leaves the model default

    @classmethod
    def from_env(cls) -> "AgentSettings":
        provider = (os.environ.get("HKM_AGENT_PROVIDER") or "openai").strip().lower()
        return cls(
            provider=provider,
            model=os.environ.get("HKM_AGENT_MODEL", "").strip(),
            api_key=provider_key(provider),
            base_url=os.environ.get("HKM_AGENT_BASE_URL", "").strip().rstrip("/"),
            timeout_seconds=float(os.environ.get("HKM_AGENT_TIMEOUT_SECONDS") or 60),
            max_output_tokens=int(os.environ.get("HKM_AGENT_MAX_OUTPUT_TOKENS") or 4000),
            reasoning_effort=(os.environ.get("HKM_AGENT_REASONING_EFFORT") or "low")
            .strip()
            .lower(),
        )

    @property
    def preset(self) -> ProviderPreset | None:
        return PROVIDERS.get(self.provider)

    @property
    def endpoint(self) -> str:
        preset = self.preset
        return (self.base_url or (preset.base_url if preset else "")).rstrip("/")

    def problem(self) -> str | None:
        """A fixed error code when the assistant cannot be used, else None."""
        preset = self.preset
        if preset is None:
            return "AGENT_UNKNOWN_PROVIDER"
        if preset.api not in IMPLEMENTED_APIS:
            return "AGENT_PROVIDER_NOT_IMPLEMENTED"
        if not self.model or not self.api_key or not self.endpoint:
            return "AGENT_NOT_CONFIGURED"
        if not self.endpoint.startswith("https://"):
            return "AGENT_INSECURE_ENDPOINT"  # the key must never travel in clear text
        return None
