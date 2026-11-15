"""End-to-end check of the home-page assistant with the real cloud model.

Runs the app in-process with a temporary database, a synthetic account and synthetic
schedule items, then asks a few questions through POST /api/v1/agent/chat and prints the
streamed steps and answers. No real account, mail or schedule data is used; the weather tool
reads the public Hong Kong Observatory feed. Each question is one or more billed API calls.

    bash -c '. scripts/load-agent-env.sh; .venv/bin/python scripts/agent-chat-check.py'
"""

import json
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ORIGIN = "http://127.0.0.1:5173"
HK = ZoneInfo("Asia/Hong_Kong")
SYNTHETIC_SUMMARY = {
    "version": "lecture-summary-v1",
    "model": "synthetic",
    "generated_at": "2026-11-12T10:00:00+00:00",
    "overview": "本节课讲解优化器（SGD、动量、Adam）与归一化方法（Batch Norm、Layer Norm）。",
    "key_points": [
        {"text": "Adam 结合动量与自适应学习率。", "at_seconds": 1500, "quotes": []},
        {
            "text": "Batch Norm 在小批量内归一化，Layer Norm 在单个样本内归一化。",
            "at_seconds": 4100,
            "quotes": [],
        },
    ],
    "reminders": [
        {
            "kind": "assignment",
            "text": "作业 3 下周五晚上 11:59 在 Moodle 提交。",
            "at_seconds": 60,
            "quotes": [],
        },
    ],
    "line_count": 800,
    "part_count": 4,
    "elapsed_seconds": 120.0,
}
QUESTIONS = [
    ["明天有什么课？"],
    ["这周还有哪些截止事项？还剩几天？"],
    ["今天香港天气怎么样，适合去行山吗？"],
    ["怎么把学校邮箱的邮件弄到 HK Mate 里？"],
    ["帮我把明天的课程表发邮件给我同学。"],
    ["明天的 NLP 课我发烧了去不了，帮我给 Prof. Chan 写封请假邮件。"],
    ["帮我加一个提醒：这周五晚上 11:59 交 DASC7606 作业 3。"],
    ["帮我加一个提醒：11 月 20 日晚上 11:59 交 DASC7606 作业 3。"],
    ["上节 Deep Learning 课讲了什么？有没有提到作业？"],
    ["我刚到香港读研究生，签证一年，要办香港身份证吗？怎么办？"],
    ["我是内地来的非本地生，可以申请港铁学生优惠吗？"],
    ["这周末想在港大附近行山，有什么新手路线？"],
    ["毕业后想留在香港工作，要怎么申请工作签证？"],
]


def converse(post, user_turns: list[str]) -> None:
    """A multi-turn chat: each reply (text only) is sent back as history."""
    history: list[dict] = []
    for text in user_turns:
        history.append({"role": "user", "content": text})
        started = time.monotonic()
        response = post("/api/v1/agent/chat", {"messages": history})
        print(f"\n>>> {text}")
        reply = ""
        for block in response.text.strip().split("\n\n"):
            kind = block.split("\n")[0].removeprefix("event: ")
            data = json.loads(block.split("\n")[1].removeprefix("data: "))
            if kind == "step" and data["state"] != "running":
                print(f"  [{data['state']}] {data['tool']}")
            elif kind == "card" and data["type"] == "choices":
                print(f"  [choices] {data['options']}")
            elif kind == "card" and data["type"] == "places":
                for place in data["places"]:
                    print(
                        f"  [place] {place['name']} | {place['rating']} | {place['price']} | "
                        f"open={place['open_now']} | {place.get('walk_minutes_from_hku')}"
                    )
            elif kind == "answer":
                reply = data["text"]
                print("  " + reply.replace("\n", "\n  "))
            elif kind == "error":
                print(f"  ERROR {data['code']}: {data['message']}")
        print(f"  ({time.monotonic() - started:.1f}s)")
        history.append({"role": "assistant", "content": reply or "（无回答）"})


def saved_turn(post, text: str, conversation_id: str | None) -> str | None:
    """One message in a saved conversation; prints what happened, returns the id."""
    body = {"message": text, **({"conversation_id": conversation_id} if conversation_id else {})}
    started = time.monotonic()
    response = post("/api/v1/agent/chat", body)
    print(f"\n>>> {text}")
    for block in response.text.strip().split("\n\n"):
        kind = block.split("\n")[0].removeprefix("event: ")
        data = json.loads(block.split("\n")[1].removeprefix("data: "))
        if kind == "conversation":
            conversation_id = data["id"]
        elif kind == "step" and data["state"] != "running":
            print(f"  [{data['state']}] {data['tool']}")
        elif kind == "card" and data["type"] == "memory_saved":
            print(f"  [memory] {data['fact']} (replaced={data['replaced']})")
        elif kind == "card" and data["type"] == "places":
            print(f"  [places] {[p['name'] + ' / ' + p['kind'] for p in data['places']]}")
        elif kind == "card" and data["type"] == "choices":
            print(f"  [choices] {data['options']}")
        elif kind == "answer":
            print("  " + data["text"].replace("\n", "\n  "))
        elif kind == "error":
            print(f"  ERROR {data['code']}: {data['message']}")
    print(f"  ({time.monotonic() - started:.1f}s)")
    return conversation_id


def remember_check(client, post) -> None:
    first = saved_turn(post, "我不吃辣，预算一般一百块以内。", None)
    saved_turn(post, "我现在住在西营盘。", first)
    print("\n[memories]", [m["fact"] for m in client.get("/api/v1/agent/memories").json()["items"]])
    # A new conversation should still know the preferences.
    saved_turn(post, "晚饭吃什么好？你直接推荐吧。", None)
    listed = client.get("/api/v1/agent/conversations").json()["items"]
    print("[conversations]", [c["title"] for c in listed])


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        database = Path(tmp) / "agent.sqlite3"
        os.environ["HKM_DATABASE_PATH"] = str(database)
        command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
        app = create_app(
            Settings(database_path=database, allowed_origins=(ORIGIN,), auto_mail_enabled=False)
        )
        with TestClient(app) as client:
            # Never touch the real token key: a temporary one encrypts the synthetic record.
            app.state.mail.vault.path = Path(tmp) / "agent-check.key"
            headers = {"Origin": ORIGIN}

            def post(path, body):
                token = client.get("/api/v1/auth/csrf").json()["csrf_token"]
                return client.post(path, json=body, headers=headers | {"X-CSRF-Token": token})

            account = {"username": "agent_check", "password": "synthetic-password-123"}
            post("/api/v1/auth/register", account)
            post("/api/v1/auth/login", account)
            status = client.get("/api/v1/agent/status").json()
            print(
                f"status: {status['provider_label']} / {status['model']}",
                f"available={status['available']}",
            )
            if not status["available"]:
                sys.exit(status["message"])
            today = datetime.now(HK).date()
            tomorrow = today + timedelta(days=1)
            for event in [
                {
                    "title": "COMP7607 NLP lecture",
                    "date": str(tomorrow),
                    "start_time": "09:30",
                    "end_time": "11:20",
                    "location": "CPD-3.04",
                },
                {
                    "title": "DASC7606 Deep Learning",
                    "date": str(tomorrow),
                    "start_time": "14:30",
                    "end_time": "17:20",
                    "location": "MWT-1",
                },
                {
                    "kind": "deadline",
                    "title": "NLP Assignment 2",
                    "date": str(today + timedelta(days=3)),
                    "start_time": "23:59",
                },
            ]:
                assert post("/api/v1/calendar/events", event).status_code == 201
            lecture_start = datetime.combine(today - timedelta(days=2), datetime.min.time(), HK)
            lecture_start = lecture_start.replace(hour=14, minute=30)
            record = {
                "course_name": "Deep Learning",
                "started_at": lecture_start.isoformat(),
                "ended_at": (lecture_start + timedelta(hours=3)).isoformat(),
                "notes": [{"at_seconds": 4200, "text": "BN vs LN 期末必考", "important": True}],
                "summary": SYNTHETIC_SUMMARY,
            }
            assert post("/api/v1/lecture-records", record).status_code == 201

            if sys.argv[1:2] == ["memory"]:
                remember_check(client, post)
                return
            if sys.argv[1:2] == ["food"]:
                converse(post, ["帮我找找西营盘美食", "你帮我推荐", "再便宜点"])
                return
            # Optional arguments pick questions by number, e.g. "2" for the second one.
            chosen = [QUESTIONS[int(n) - 1] for n in sys.argv[1:]] or QUESTIONS
            for turns in chosen:
                messages = [{"role": "user", "content": text} for text in turns]
                started = time.monotonic()
                response = post("/api/v1/agent/chat", {"messages": messages, "signature": "Sam"})
                print(f"\n>>> {turns[-1]}")
                if response.status_code != 200:
                    print(f"HTTP {response.status_code}: {response.json()['error']}")
                    continue
                for block in response.text.strip().split("\n\n"):
                    kind = block.split("\n")[0].removeprefix("event: ")
                    data = json.loads(block.split("\n")[1].removeprefix("data: "))
                    if kind == "step" and data["state"] != "running":
                        print(f"  [{data['state']}] {data['tool']}")
                    elif kind == "card" and data["type"] == "email_draft":
                        print(f"  [card] email draft to {data['recipient_name']!r}")
                        print(f"    subject: {data['subject']}")
                        print("    " + data["body"].replace("\n", "\n    "))
                        print(f"    to check: {data['missing_info']}")
                    elif kind == "card" and data["type"] == "knowledge":
                        print(f"  [card] sources: {[x['label'] for x in data['sources']]}")
                    elif kind == "card" and data["type"] == "event_proposal":
                        print(f"  [card] proposal: {json.dumps(data, ensure_ascii=False)}")
                    elif kind == "card":
                        print(f"  [card] {data['type']}: {len(data.get('items', []))} items")
                    elif kind == "answer":
                        print("  " + data["text"].replace("\n", "\n  "))
                    elif kind == "error":
                        print(f"  ERROR {data['code']}: {data['message']}")
                print(f"  ({time.monotonic() - started:.1f}s)")


if __name__ == "__main__":
    main()
