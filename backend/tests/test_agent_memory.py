import json

import pytest
from app.agent import memory
from app.agent.memory import Remember, remember
from app.agent.models import ModelError
from app.models import AgentConversation, AgentMemory
from sqlalchemy import func, select
from test_agent_api import READY, RateLimiter, ScriptedModel, answer, events, tool_turn, use
from test_auth import login, register
from test_calendar import write

CHAT = "/api/v1/agent/chat"


@pytest.fixture
def agent(client, tmp_path):
    # Never touch the real key file during tests.
    client.app.state.mail.vault.path = tmp_path / "agent-memory-test.key"
    client.app.state.agent_settings = READY
    client.app.state.agent_limiter = RateLimiter(per_minute=100, per_day=1000)
    return client


def say(client, message, conversation_id=None):
    body = {"message": message}
    if conversation_id:
        body["conversation_id"] = conversation_id
    return write(client, "POST", CHAT, body)


def user_id(client):
    return client.get("/api/v1/users/me").json()["id"]


def context(client):
    return {
        "user_id": user_id(client),
        "vault": client.app.state.mail.vault,
        "session_factory": client.app.state.session_factory,
    }


def test_conversations_are_saved_encrypted_and_continue(agent):
    register(agent)
    login(agent)
    model = use(agent, ScriptedModel(answer("你好！想问点什么？")))
    first = events(say(agent, "  你好，我是新生  "))
    assert first[0][0] == "conversation"
    conversation = first[0][1]
    assert conversation["title"] == "你好，我是新生"
    # The model gets the system prompt, what it remembers (nothing yet) and the message.
    sent = model.seen[0][0]
    assert sent[1].content.startswith("You do not remember anything")
    assert sent[-1].content == "你好，我是新生"

    model = use(agent, ScriptedModel(answer("那我们先看看日程。")))
    second = events(say(agent, "帮我看看明天", conversation["id"]))
    assert second[0] == ("conversation", conversation)
    assert [m.content for m in model.seen[0][0][2:]] == [
        "你好，我是新生",
        "你好！想问点什么？",
        "帮我看看明天",
    ]

    detail = agent.get(f"/api/v1/agent/conversations/{conversation['id']}").json()
    assert [(m["role"], m["content"]) for m in detail["messages"]] == [
        ("user", "你好，我是新生"),
        ("assistant", "你好！想问点什么？"),
        ("user", "帮我看看明天"),
        ("assistant", "那我们先看看日程。"),
    ]
    listed = agent.get("/api/v1/agent/conversations").json()["items"]
    assert [item["id"] for item in listed] == [conversation["id"]]
    with agent.app.state.session_factory() as db:
        row = db.scalar(select(AgentConversation))
    assert "新生" not in row.encrypted_payload and "日程" not in row.encrypted_payload


def test_places_are_not_kept_and_failures_are_recorded(agent):
    register(agent)
    login(agent)

    class PlacesModel(ScriptedModel):
        pass

    use(
        agent,
        ScriptedModel(
            tool_turn(("offer_choices", {"options": ["中餐", "甜品"]})), answer("想吃什么？")
        ),
    )
    conversation = events(say(agent, "找吃的"))[0][1]
    stored = memory.stored_cards(
        [{"type": "places", "query": "川菜", "places": [{"name": "店"}]}, {"type": "choices"}]
    )
    assert stored == [{"type": "places_expired", "query": "川菜"}, {"type": "choices"}]
    use(agent, ScriptedModel(ModelError("AGENT_TIMEOUT")))
    events(say(agent, "川菜", conversation["id"]))
    detail = agent.get(f"/api/v1/agent/conversations/{conversation['id']}").json()
    assert detail["messages"][1]["cards"] == [{"type": "choices", "options": ["中餐", "甜品"]}]
    assert detail["messages"][-1] == {
        "role": "assistant",
        "content": "",
        "cards": [],
        "error": "AI 服务响应超时，请稍后再试。",
    }
    # Failed replies are not sent back to the model.
    model = use(agent, ScriptedModel(answer("好")))
    events(say(agent, "再试一次", conversation["id"]))
    assert [m.content for m in model.seen[0][0][2:]] == ["找吃的", "想吃什么？", "川菜", "再试一次"]


def test_conversations_belong_to_their_owner(agent):
    register(agent)
    login(agent)
    use(agent, ScriptedModel(answer("好")))
    conversation = events(say(agent, "我的秘密计划"))[0][1]
    register(agent, username="other_user")
    login(agent, username="other_user")
    use(agent, ScriptedModel(answer("好")))
    path = f"/api/v1/agent/conversations/{conversation['id']}"
    assert agent.get(path).status_code == 404
    assert write(agent, "DELETE", path).status_code == 404
    assert say(agent, "继续", conversation["id"]).status_code == 404
    assert agent.get("/api/v1/agent/conversations").json()["items"] == []
    login(agent)
    assert write(agent, "DELETE", path).status_code == 204
    assert agent.get(path).status_code == 404
    assert agent.get("/api/v1/agent/conversations").status_code == 200
    assert write(agent, "DELETE", path).status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"messages": [{"role": "user", "content": "x"}], "message": "x"},
        {"messages": [{"role": "user", "content": "x"}], "conversation_id": "c"},
        {"message": ""},
        {"message": "x" * 4001},
    ],
)
def test_chat_needs_exactly_one_mode(agent, body):
    use(agent, ScriptedModel())
    register(agent)
    login(agent)
    assert write(agent, "POST", CHAT, body).status_code == 422


def test_only_the_newest_twenty_conversations_are_kept(agent):
    register(agent)
    login(agent)
    uid = user_id(agent)
    vault = agent.app.state.mail.vault
    with agent.app.state.session_factory() as db:
        for number in range(25):
            row, _ = memory.create_conversation(db, vault, uid, f"问题 {number}")
            row.created_at = row.updated_at = 1_000 + number
            db.commit()
        titles = [item["title"] for item in memory.list_conversations(db, vault, uid)]
        count = db.scalar(select(func.count()).select_from(AgentConversation))
    assert count == 20
    assert titles[0] == "问题 24" and titles[-1] == "问题 5"


def test_long_conversations_send_a_summary_and_the_recent_messages():
    payload = {"title": "t", "summary": "", "summarized": 0, "messages": []}
    for number in range(46):
        role = "user" if number % 2 == 0 else "assistant"
        payload["messages"].append({"role": role, "content": f"消息 {number}"})
    payload["messages"].insert(10, {"role": "assistant", "content": "", "error": "x"})
    assert memory.needs_summary(payload)
    model = ScriptedModel(answer("用户在找西营盘的川菜，已推荐三家。" * 20))
    updated = memory.summarize(model, payload)
    sent = json.loads(model.seen[0][0][1].content)
    assert [m["content"] for m in sent["messages"]][:2] == ["消息 0", "消息 1"]
    assert len(sent["messages"]) == 26  # all but the last 20 answered messages
    assert len(updated["summary"]) == memory.SUMMARY_CHARS
    assert updated["summarized"] == 26 and not memory.needs_summary(updated)
    history = memory.model_history(updated)
    assert history[0].role == "system" and history[0].content.startswith("Summary of the earlier")
    assert [m.content for m in history[1:]][0] == "消息 26"
    assert len(history) == 21
    short = {"title": "t", "summary": "", "summarized": 0, "messages": payload["messages"][:30]}
    assert not memory.needs_summary(short)
    assert memory.summarize(ScriptedModel(), short | {"messages": []}) == short | {"messages": []}


def test_remember_saves_updates_and_refuses_secrets(agent):
    register(agent)
    login(agent)
    ctx = context(agent)
    saved = remember(Remember(fact=" 不吃辣 "), ctx)
    assert saved.for_model == {"status": "saved", "fact": "不吃辣"}
    assert saved.card["type"] == "memory_saved" and saved.card["fact"] == "不吃辣"
    assert remember(Remember(fact="不吃辣"), ctx).for_model["status"] == "already_remembered"
    home = remember(Remember(fact="住在西营盘"), ctx)
    moved = remember(Remember(fact="住在坚尼地城", replaces=home.card["id"][:8]), ctx)
    assert moved.for_model["status"] == "updated" and moved.card["id"] == home.card["id"]
    facts = [m["fact"] for m in agent.get("/api/v1/agent/memories").json()["items"]]
    assert facts == ["不吃辣", "住在坚尼地城"]
    for secret in ["我的密码是 abc", "卡号 4111111111111111", "邮箱 me@example.com", "A123456(7)"]:
        refused = remember(Remember(fact=secret), ctx)
        assert "Not saved" in refused.for_model["error"] and refused.card is None
    with agent.app.state.session_factory() as db:
        stored = [row.encrypted_fact for row in db.scalars(select(AgentMemory))]
    assert all("辣" not in text for text in stored)


def test_memories_are_given_to_the_model_and_can_be_undone(agent):
    register(agent)
    login(agent)
    model = use(
        agent,
        ScriptedModel(
            tool_turn(("remember", {"fact": "不吃辣"})), answer("记住了，以后避开辣的。")
        ),
    )
    kinds = events(say(agent, "我不吃辣"))
    # Remembering shows a card, not a visible step.
    assert [kind for kind, _ in kinds] == ["conversation", "card", "answer", "done"]
    card = kinds[1][1]
    assert card["type"] == "memory_saved" and card["fact"] == "不吃辣"
    model = use(agent, ScriptedModel(answer("好")))
    events(say(agent, "推荐点吃的"))
    assert f"[{card['id'][:8]}] 不吃辣" in model.seen[0][0][1].content

    assert write(agent, "DELETE", f"/api/v1/agent/memories/{card['id']}").status_code == 204
    assert agent.get("/api/v1/agent/memories").json()["items"] == []
    remember(Remember(fact="读 MSc CS"), context(agent))
    register(agent, username="other_user")
    login(agent, username="other_user")
    assert agent.get("/api/v1/agent/memories").json()["items"] == []
    mine = None
    login(agent)
    mine = agent.get("/api/v1/agent/memories").json()["items"][0]["id"]
    login(agent, username="other_user")
    assert write(agent, "DELETE", f"/api/v1/agent/memories/{mine}").status_code == 404
    assert write(agent, "DELETE", "/api/v1/agent/memories").status_code == 204
    login(agent)
    assert len(agent.get("/api/v1/agent/memories").json()["items"]) == 1
    assert write(agent, "DELETE", "/api/v1/agent/memories").status_code == 204
    assert agent.get("/api/v1/agent/memories").json()["items"] == []


def test_too_many_memories_are_merged_or_trimmed(agent):
    register(agent)
    login(agent)
    ctx = context(agent)
    for number in range(memory.MAX_MEMORIES):
        remember(Remember(fact=f"偏好 {number}"), ctx)
    assert "merge_memories" not in ctx
    remember(Remember(fact="偏好 30"), ctx)
    assert ctx["merge_memories"] is True
    uid, vault = ctx["user_id"], ctx["vault"]
    merged = ScriptedModel(answer("- 喜欢清淡\n1. 预算 100 元以内\n密码 123456\n喜欢清淡"))
    with agent.app.state.session_factory() as db:
        memory.merge_memories(db, vault, uid, merged)
        db.commit()
        facts = [m["fact"] for m in memory.list_memories(db, vault, uid)]
    assert facts == ["喜欢清淡", "预算 100 元以内"]

    for number in range(memory.MAX_MEMORIES):
        remember(Remember(fact=f"新偏好 {number}"), ctx)
    with agent.app.state.session_factory() as db:
        memory.merge_memories(db, vault, uid, ScriptedModel(ModelError("AGENT_TIMEOUT")))
        db.commit()
        facts = [m["fact"] for m in memory.list_memories(db, vault, uid)]
    # If merging fails, the newest facts are kept.
    assert len(facts) == memory.MERGE_TO and facts[-1] == "新偏好 29"
