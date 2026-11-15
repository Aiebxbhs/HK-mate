import json

import httpx
import pytest
from app.agent.models import (
    Message,
    ModelError,
    OpenAIChatModel,
    OpenAIResponsesModel,
    ToolCall,
    ToolSpec,
    create_model,
)
from app.agent.providers import PROVIDERS, AgentSettings
from app.agent.runtime import AgentLoop, Tool, ToolResult
from pydantic import BaseModel, Field

KEY = "sk-test-not-a-real-key"
SETTINGS = AgentSettings(provider="openai", model="test-model", api_key=KEY)
WEATHER = ToolSpec(
    "get_weather",
    "Current Hong Kong weather.",
    {"type": "object", "properties": {"district": {"type": "string"}}},
)


def completion(content=None, tool_calls=None, finish="stop", usage=(12, 5)):
    message = {"role": "assistant", "content": content}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return {
        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
        "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1]},
    }


def call(call_id, name, arguments):
    raw = arguments if isinstance(arguments, str) else json.dumps(arguments)
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": raw}}


def model(*responses, seen=None, settings=SETTINGS):
    queue = list(responses)

    def handle(request):
        if seen is not None:
            seen.append(request)
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, httpx.Response):
            return item
        return httpx.Response(200, json=item)

    client = httpx.Client(transport=httpx.MockTransport(handle))
    return OpenAIChatModel(settings, client, retry_delay=0)


def test_request_uses_openai_chat_completions_format():
    seen = []
    turn = model(completion("你好！"), seen=seen).complete(
        [Message("system", "Be brief."), Message("user", "hi")], [WEATHER]
    )
    request = seen[0]
    assert str(request.url) == "https://api.openai.com/v1/chat/completions"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    body = json.loads(request.content)
    assert body["model"] == "test-model"
    assert body["messages"] == [
        {"role": "system", "content": "Be brief."},
        {"role": "user", "content": "hi"},
    ]
    assert body["tools"][0] == {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Current Hong Kong weather.",
            "parameters": WEATHER.parameters,
        },
    }
    assert body["tool_choice"] == "auto"
    assert body["max_completion_tokens"] == 4000 and "max_tokens" not in body
    assert "temperature" not in body  # some newer models reject non-default values
    assert turn.text == "你好！" and turn.finish == "stop" and turn.tool_calls == []
    assert (turn.usage.input_tokens, turn.usage.output_tokens) == (12, 5)


def test_tool_calls_and_tool_results_round_trip():
    seen = []
    chat = model(
        completion(
            tool_calls=[call("c1", "get_weather", {"district": "Central"})], finish="tool_calls"
        ),
        completion("中环现在 24 度。"),
        seen=seen,
    )
    first = chat.complete([Message("user", "天气？")], [WEATHER])
    assert first.finish == "tool_calls"
    assert first.tool_calls == [ToolCall("c1", "get_weather", {"district": "Central"})]
    history = [
        Message("user", "天气？"),
        Message("assistant", "", tool_calls=first.tool_calls),
        Message("tool", '{"temp": 24}', tool_call_id="c1"),
    ]
    chat.complete(history, [WEATHER])
    sent = json.loads(seen[1].content)["messages"]
    assert sent[1] == {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "c1",
                "type": "function",
                "function": {"name": "get_weather", "arguments": '{"district": "Central"}'},
            }
        ],
    }
    assert sent[2] == {"role": "tool", "tool_call_id": "c1", "content": '{"temp": 24}'}


def test_broken_tool_arguments_are_kept_as_none():
    turn = model(completion(tool_calls=[call("c1", "get_weather", "{not json")])).complete(
        [Message("user", "x")], [WEATHER]
    )
    assert turn.tool_calls[0].arguments is None and turn.finish == "tool_calls"


@pytest.mark.parametrize(
    "status,body,code",
    [
        (401, {"error": {"code": "invalid_api_key"}}, "AGENT_AUTH_FAILED"),
        (
            403,
            {"error": {"code": "unsupported_country_region_territory"}},
            "AGENT_REGION_UNSUPPORTED",
        ),
        (429, {"error": {"code": "insufficient_quota"}}, "AGENT_QUOTA_EXCEEDED"),
        (400, {"error": {"code": "context_length_exceeded"}}, "AGENT_INPUT_TOO_LONG"),
        (404, {"error": {"code": "model_not_found"}}, "AGENT_MODEL_NOT_FOUND"),
        (400, {"error": {"message": "secret user text"}}, "AGENT_BAD_REQUEST"),
    ],
)
def test_errors_become_fixed_codes_without_provider_text(status, body, code):
    with pytest.raises(ModelError) as raised:
        model(httpx.Response(status, json=body)).complete([Message("user", "x")], [])
    assert raised.value.code == code
    assert "secret" not in str(raised.value) and KEY not in str(raised.value)


def test_transient_failures_are_retried_once():
    ok = model(httpx.Response(503), completion("好")).complete([Message("user", "x")], [])
    assert ok.text == "好"
    with pytest.raises(ModelError, match="AGENT_RATE_LIMITED"):
        model(httpx.Response(429, json={}), httpx.Response(429, json={})).complete(
            [Message("user", "x")], []
        )
    with pytest.raises(ModelError, match="AGENT_UNAVAILABLE"):
        model(httpx.ConnectError("down"), httpx.ConnectError("down")).complete(
            [Message("user", "x")], []
        )
    with pytest.raises(ModelError, match="AGENT_TIMEOUT"):
        model(httpx.ReadTimeout("slow")).complete([Message("user", "x")], [])
    with pytest.raises(ModelError, match="AGENT_BAD_RESPONSE"):
        model({"unexpected": True}).complete([Message("user", "x")], [])


def test_settings_validation_and_providers():
    assert "api_key" not in repr(SETTINGS) and KEY not in repr(SETTINGS)
    assert AgentSettings().problem() == "AGENT_NOT_CONFIGURED"
    assert AgentSettings(provider="nope").problem() == "AGENT_UNKNOWN_PROVIDER"
    assert (
        AgentSettings(provider="anthropic", model="m", api_key=KEY).problem()
        == "AGENT_PROVIDER_NOT_IMPLEMENTED"
    )
    plain = AgentSettings(provider="custom", model="m", api_key=KEY, base_url="http://x.example")
    assert plain.problem() == "AGENT_INSECURE_ENDPOINT"
    with pytest.raises(ModelError, match="AGENT_NOT_CONFIGURED"):
        create_model(AgentSettings())

    # Mainland and other compatible providers reuse the same adapter with their own URL.
    seen = []
    deepseek = AgentSettings(provider="deepseek", model="deepseek-chat", api_key=KEY)
    model(completion("好"), seen=seen, settings=deepseek).complete([Message("user", "x")], [])
    assert str(seen[0].url) == "https://api.deepseek.com/v1/chat/completions"
    assert "max_tokens" in json.loads(seen[0].content)
    assert {p.region for p in PROVIDERS.values()} == {"global", "mainland"}
    assert all(p.base_url.startswith("https://") for p in PROVIDERS.values() if p.base_url)
    assert [p.name for p in PROVIDERS.values() if p.status == "ready"] == ["openai"]


def test_env_settings(monkeypatch):
    monkeypatch.setenv("HKM_AGENT_PROVIDER", " QWEN ")
    monkeypatch.setenv("HKM_AGENT_MODEL", "qwen-plus")
    monkeypatch.setenv("HKM_AGENT_API_KEY", KEY)
    monkeypatch.setenv("HKM_AGENT_BASE_URL", "https://proxy.example/v1/")
    settings = AgentSettings.from_env()
    assert settings.provider == "qwen" and settings.problem() is None
    assert settings.endpoint == "https://proxy.example/v1"


# --- the tool-calling loop ---


class District(BaseModel):
    district: str = Field(min_length=1, max_length=40)


def weather_tool(calls):
    def run(arguments, context):
        calls.append((arguments.district, context["user_id"]))
        if arguments.district == "Boom":
            raise RuntimeError("private detail")
        return ToolResult({"temp": 24}, card={"type": "weather", "district": arguments.district})

    return Tool("get_weather", "Current weather in a district.", District, run)


def test_loop_runs_tools_and_returns_answer_with_cards():
    seen, calls = [], []
    chat = model(
        completion(tool_calls=[call("c1", "get_weather", {"district": "Central"})]),
        completion("中环 24 度。", usage=(30, 8)),
        seen=seen,
    )
    steps = []
    result = AgentLoop(chat, [weather_tool(calls)]).run(
        [Message("user", "中环天气？")], {"user_id": "u1"}, on_step=steps.append
    )
    assert result.text == "中环 24 度。" and result.stopped == "answered"
    assert result.cards == [{"type": "weather", "district": "Central"}]
    assert calls == [("Central", "u1")]  # identity from the caller, not the model
    assert [s.name for s in steps] == ["get_weather"] and steps[0].ok
    assert (result.usage.input_tokens, result.usage.output_tokens) == (42, 13)
    tool_msg = json.loads(seen[1].content)["messages"][-1]
    assert tool_msg == {"role": "tool", "tool_call_id": "c1", "content": '{"temp": 24}'}
    assert "card" not in tool_msg["content"]
    schema = json.loads(seen[0].content)["tools"][0]["function"]["parameters"]
    assert schema["properties"]["district"]["maxLength"] == 40 and "title" not in schema


def test_loop_reports_bad_calls_to_the_model_and_keeps_going():
    seen, calls = [], []
    chat = model(
        completion(
            tool_calls=[
                call("a", "send_email", {"to": "x"}),
                call("b", "get_weather", {"district": ""}),
                call("c", "get_weather", "nope"),
                call("d", "get_weather", {"district": "Boom"}),
            ]
        ),
        completion("抱歉，天气服务暂时不可用。"),
        seen=seen,
    )
    result = AgentLoop(chat, [weather_tool(calls)]).run([Message("user", "x")], {"user_id": "u"})
    assert [(s.name, s.error) for s in result.steps] == [
        ("send_email", "unknown_tool"),
        ("get_weather", "invalid_arguments"),
        ("get_weather", "invalid_arguments"),
        ("get_weather", "tool_failed"),
    ]
    replies = [m["content"] for m in json.loads(seen[1].content)["messages"] if m["role"] == "tool"]
    assert "Unknown tool" in replies[0] and "district" in replies[1]
    assert "private detail" not in "".join(replies)
    assert result.text.startswith("抱歉")


def test_loop_stops_after_max_steps_and_forces_an_answer():
    seen = []
    looping = completion(tool_calls=[call("c", "get_weather", {"district": "Central"})])
    chat = model(looping, looping, completion("先告诉你目前知道的。"), seen=seen)
    result = AgentLoop(chat, [weather_tool([])], max_steps=3).run(
        [Message("user", "x")], {"user_id": "u"}
    )
    assert result.text == "先告诉你目前知道的。" and len(result.steps) == 2
    assert "tools" not in json.loads(seen[2].content)  # last step: no tools offered

    endless = model(looping, looping, looping)
    stopped = AgentLoop(endless, [weather_tool([])], max_steps=3).run(
        [Message("user", "x")], {"user_id": "u"}
    )
    assert stopped.stopped == "max_steps"
    with pytest.raises(ModelError, match="AGENT_EMPTY_ANSWER"):
        AgentLoop(model(completion("")), []).run([Message("user", "x")], {})


def test_blank_env_values_fall_back_to_defaults(monkeypatch):
    monkeypatch.setenv("HKM_AGENT_PROVIDER", "")
    monkeypatch.setenv("HKM_AGENT_TIMEOUT_SECONDS", "")
    monkeypatch.setenv("HKM_AGENT_MAX_OUTPUT_TOKENS", "")
    settings = AgentSettings.from_env()
    assert settings.provider == "openai" and settings.timeout_seconds == 60
    assert settings.max_output_tokens == 4000 and settings.reasoning_effort == "low"


# --- OpenAI Responses API (GPT-6.1 Terra and newer) ---

TERRA = AgentSettings(provider="openai", model="gpt-6.1-terra", api_key=KEY)


def responses(*items, status="completed", reason=None, usage=(20, 7)):
    body = {
        "id": "resp_test",
        "status": status,
        "output": list(items),
        "usage": {"input_tokens": usage[0], "output_tokens": usage[1]},
    }
    if reason:
        body["incomplete_details"] = {"reason": reason}
    return body


def text_item(text):
    return {
        "type": "message",
        "role": "assistant",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    }


REASONING = {"type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "opaque"}


def responses_model(*replies, seen=None, settings=TERRA):
    queue = list(replies)

    def handle(request):
        if seen is not None:
            seen.append(request)
        item = queue.pop(0)
        return item if isinstance(item, httpx.Response) else httpx.Response(200, json=item)

    return OpenAIResponsesModel(
        settings, httpx.Client(transport=httpx.MockTransport(handle)), retry_delay=0
    )


def test_openai_uses_the_responses_api_by_default():
    assert isinstance(create_model(TERRA), OpenAIResponsesModel)
    seen = []
    turn = responses_model(responses(REASONING, text_item("你好！")), seen=seen).complete(
        [Message("system", "Be brief."), Message("user", "hi")], [WEATHER]
    )
    request = seen[0]
    assert str(request.url) == "https://api.openai.com/v1/responses"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    body = json.loads(request.content)
    assert body["model"] == "gpt-6.1-terra"
    assert body["instructions"] == "Be brief."
    assert body["input"] == [{"role": "user", "content": "hi"}]
    assert body["tools"] == [
        {
            "type": "function",
            "name": "get_weather",
            "description": "Current Hong Kong weather.",
            "parameters": WEATHER.parameters,
        }
    ]
    assert body["store"] is False  # not kept as a stored response
    assert body["include"] == ["reasoning.encrypted_content"]
    assert body["reasoning"] == {"effort": "low"}
    assert body["max_output_tokens"] == 4000
    assert turn.text == "你好！" and turn.finish == "stop" and turn.provider_items == []
    assert (turn.usage.input_tokens, turn.usage.output_tokens) == (20, 7)


def test_responses_tool_round_trip_replays_reasoning_items():
    seen = []
    call_item = {
        "type": "function_call",
        "id": "fc_1",
        "call_id": "call_1",
        "name": "get_weather",
        "arguments": '{"district": "Central"}',
    }
    chat = responses_model(
        responses(REASONING, call_item), responses(text_item("中环 24 度。")), seen=seen
    )
    first = chat.complete([Message("user", "天气？")], [WEATHER])
    assert first.finish == "tool_calls"
    assert first.tool_calls == [ToolCall("call_1", "get_weather", {"district": "Central"})]
    assert first.provider_items == [REASONING, call_item]
    history = [
        Message("user", "天气？"),
        Message("assistant", "", first.tool_calls, provider_items=first.provider_items),
        Message("tool", '{"temp": 24}', tool_call_id="call_1"),
    ]
    second = chat.complete(history, [WEATHER])
    assert json.loads(seen[1].content)["input"] == [
        {"role": "user", "content": "天气？"},
        REASONING,
        call_item,
        {"type": "function_call_output", "call_id": "call_1", "output": '{"temp": 24}'},
    ]
    assert second.text == "中环 24 度。"


def test_responses_without_provider_items_rebuilds_calls_and_handles_incomplete():
    items = OpenAIResponsesModel.input_items(
        [
            Message("assistant", "查一下", [ToolCall("c", "get_weather", {"district": "X"})]),
            Message("assistant", "好的"),
        ]
    )
    assert items == [
        {"role": "assistant", "content": "查一下"},
        {
            "type": "function_call",
            "call_id": "c",
            "name": "get_weather",
            "arguments": '{"district": "X"}',
        },
        {"role": "assistant", "content": "好的"},
    ]
    cut = responses_model(
        responses(text_item("一半"), status="incomplete", reason="max_output_tokens")
    ).complete([Message("user", "x")], [])
    assert cut.finish == "length" and cut.text == "一半"
    filtered = responses_model(responses(status="incomplete", reason="content_filter")).complete(
        [Message("user", "x")], []
    )
    assert filtered.finish == "content_filter"
    with pytest.raises(ModelError, match="AGENT_BAD_RESPONSE"):
        responses_model({"no_output": True}).complete([Message("user", "x")], [])
    with pytest.raises(ModelError, match="AGENT_REGION_UNSUPPORTED"):
        responses_model(
            httpx.Response(403, json={"error": {"code": "unsupported_country_region_territory"}})
        ).complete([Message("user", "x")], [])
    no_effort = AgentSettings(provider="openai", model="m", api_key=KEY, reasoning_effort="")
    seen = []
    responses_model(responses(text_item("好")), seen=seen, settings=no_effort).complete(
        [Message("user", "x")], []
    )
    assert "reasoning" not in json.loads(seen[0].content)


def test_loop_keeps_reasoning_items_across_tool_steps():
    seen, calls = [], []
    call_item = {
        "type": "function_call",
        "call_id": "call_9",
        "name": "get_weather",
        "arguments": '{"district": "Central"}',
    }
    chat = responses_model(
        responses(REASONING, call_item), responses(text_item("好的。")), seen=seen
    )
    result = AgentLoop(chat, [weather_tool(calls)]).run(
        [Message("system", "s"), Message("user", "x")], {"user_id": "u"}
    )
    assert result.text == "好的。" and calls == [("Central", "u")]
    replayed = json.loads(seen[1].content)["input"]
    assert REASONING in replayed and replayed[-1]["type"] == "function_call_output"


def test_each_provider_can_keep_its_own_key(monkeypatch):
    from app.agent.providers import google_maps_key, key_variable

    for name in ("HKM_AGENT_API_KEY", "HKM_AGENT_MODEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HKM_AGENT_OPENAI_API_KEY", "sk-openai-test")
    monkeypatch.setenv("HKM_AGENT_DEEPSEEK_API_KEY", "sk-deepseek-test")
    monkeypatch.setenv("HKM_AGENT_PROVIDER", "deepseek")
    assert AgentSettings.from_env().api_key == "sk-deepseek-test"
    monkeypatch.setenv("HKM_AGENT_PROVIDER", "openai")
    assert AgentSettings.from_env().api_key == "sk-openai-test"
    monkeypatch.setenv("HKM_AGENT_PROVIDER", "qwen_intl")
    assert key_variable("qwen_intl") == "HKM_AGENT_QWEN_INTL_API_KEY"
    assert AgentSettings.from_env().api_key == ""  # no key for that provider yet
    monkeypatch.setenv("HKM_AGENT_API_KEY", "sk-shared")  # the shared key still wins
    assert AgentSettings.from_env().api_key == "sk-shared"
    monkeypatch.setenv("HKM_AGENT_GOOGLE_MAPS_API_KEY", " AIza-test ")
    assert google_maps_key() == "AIza-test"
