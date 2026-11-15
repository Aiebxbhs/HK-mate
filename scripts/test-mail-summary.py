"""Explicit, opt-in real-mail test (1–20 messages); never prints mail content."""

import argparse
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.config import Settings  # noqa: E402
from app.core.database import create_database  # noqa: E402
from app.gmail import GoogleMailbox, TokenVault  # noqa: E402
from app.mail_service import MailService  # noqa: E402
from app.mail_summary import MODEL, PROMPT_VERSION, LocalMailSummarizer, SummaryError  # noqa: E402
from app.models import EmailConnection, User  # noqa: E402
from app.services import AuthError  # noqa: E402
from sqlalchemy import select  # noqa: E402


def write_readable_report(report: dict, path: Path) -> None:
    lines = [
        "HK Mate 本地邮件摘要测试",
        f"模型：{report['model']}",
        f"生成时间：{report['created_at']}",
        "自动检查涵盖格式与引用，摘要含义是否准确仍需对照原邮件。",
        "",
    ]
    for index, record in enumerate(report["items"], 1):
        lines.extend(
            [
                f"—— 第 {index} 封 ——",
                f"主题：{record['subject']}",
            ]
        )
        if record["status"] != "ok":
            lines.extend([f"失败：{record['error_code']}", ""])
            continue
        summary = record["summary"]
        lines.extend([f"耗时：{record['elapsed_seconds']} 秒", "", summary["overview"]])
        lines.extend(f"限制：{item}" for item in summary["uncertainties"])
        lines.append("")
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write("\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--username", help="Required if multiple users have connected mailboxes")
    parser.add_argument("--connection-id", help="Required if the owner has multiple mailboxes")
    parser.add_argument(
        "--replay-report", type=Path, help="Retest IDs from an existing private report"
    )
    parser.add_argument("--count", type=int, choices=range(1, 21), default=5)
    parser.add_argument("--allow-real-mail", action="store_true", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    settings = Settings()
    engine, sessions = create_database(settings)
    service = MailService(GoogleMailbox(settings), TokenVault(settings))
    agent = LocalMailSummarizer()
    records = []
    started = time.monotonic()
    try:
        with sessions() as db:
            query = select(User).where(
                User.is_active.is_(True),
                User.id.in_(select(EmailConnection.user_id)),
            )
            if args.username:
                query = query.where(User.username == args.username.strip().lower())
            users = list(db.scalars(query))
            if len(users) != 1:
                print("Select exactly one mailbox owner using --username.", flush=True)
                return 1
            user_id = users[0].id
            connections = list(
                db.scalars(select(EmailConnection.id).where(EmailConnection.user_id == user_id))
            )
            if args.connection_id:
                connections = [item for item in connections if item == args.connection_id]
            if len(connections) != 1:
                print("Select exactly one owned mailbox using --connection-id.")
                return 1
            connection_id = connections[0]
            if args.replay_report:
                try:
                    replay = args.replay_report.resolve()
                    if not replay.is_relative_to(ROOT / "private-data/summary-tests"):
                        raise ValueError()
                    previous = json.loads(replay.read_text())["items"]
                    if len(previous) < args.count or any(
                        row["user_id"] != user_id or row["connection_id"] != connection_id
                        for row in previous
                    ):
                        raise ValueError()
                    items = [{"id": row["message_id"]} for row in previous[: args.count]]
                except (OSError, ValueError, KeyError, TypeError):
                    print("Replay requires a private report for the same owner and mailbox.")
                    return 1
            else:
                _, token = service.access(db, user_id, connection_id)
                # List only the requested IDs and retrieve only those message bodies.
                listing = service.google.request(
                    token,
                    "messages",
                    {
                        "maxResults": args.count,
                        "includeSpamTrash": "false",
                        "q": "-in:sent -in:drafts -in:trash",
                    },
                )
                items = listing.get("messages", [])
            if len(items) != args.count:
                print(f"Cannot obtain {args.count} received messages.")
                return 1
            for index, item in enumerate(items, 1):
                mail = service.message(db, user_id, connection_id, item["id"])
                db.rollback()  # No database transaction held during local inference.
                record = {
                    "user_id": user_id,
                    "connection_id": connection_id,
                    "message_id": item["id"],
                    "subject": mail.subject,
                    "sender": mail.sender,
                    "received_at": mail.received_at.isoformat(),
                    "body_chars": len(mail.body),
                }
                try:
                    result = agent.summarize(mail)
                    record.update(
                        status="ok",
                        summary=result.summary.model_dump(),
                        elapsed_seconds=result.elapsed_seconds,
                        input_truncated=result.input_truncated,
                        generated_tokens=result.generated_tokens,
                    )
                    print(f"Mail {index}/{args.count}: OK ({result.elapsed_seconds}s)", flush=True)
                except SummaryError as exc:
                    record.update(status="failed", error_code=str(exc))
                    print(f"Mail {index}/{args.count}: {exc}", flush=True)
                records.append(record)
    except AuthError as exc:
        print(f"Mailbox test stopped: {exc.code}", flush=True)
        return 1
    finally:
        engine.dispose()
    output = ROOT / "private-data/summary-tests"
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    report = {
        "created_at": datetime.now(UTC).isoformat(),
        "model": MODEL,
        "prompt_version": PROMPT_VERSION,
        "count": args.count,
        "scope": "received (excluding sent/drafts/trash/spam)",
        "total_seconds": round(time.monotonic() - started, 2),
        "checks": "JSON schema, source evidence, literal deadlines; semantic accuracy needs review",
        "items": records,
    }
    path = output / f"recent-{args.count}-{datetime.now(UTC):%Y%m%dT%H%M%SZ}.json"
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    write_readable_report(report, path.with_suffix(".txt"))
    success = sum(record["status"] == "ok" for record in records)
    print(f"Result: {success}/{args.count}; private report: {path.relative_to(ROOT)}", flush=True)
    return 0 if success == args.count else 1


if __name__ == "__main__":
    raise SystemExit(main())
