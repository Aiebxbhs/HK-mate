"""Single-process local mailbox monitor. Stores no plaintext subjects, bodies or summaries."""

import json
import time
from collections.abc import Callable
from threading import Event, Lock, Thread
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session, sessionmaker

from app import mail_categories
from app.gmail import summary
from app.mail_service import MailService
from app.mail_summary import LocalMailSummarizer, SummaryError
from app.models import EmailConnection, MailNotification, MailWatch, User
from app.services import AuthError

# Older mail is rescanned every ten minutes, a few provider pages at most.
BACKFILL_EVERY = 600
BACKFILL_PAGES = 3


class MailMonitor:
    def __init__(
        self,
        sessions: sessionmaker[Session],
        mail: MailService,
        summarizer: LocalMailSummarizer,
        model_lock: Lock,
        paused: Callable[[], bool] = lambda: False,
    ) -> None:
        self.sessions, self.mail, self.summarizer = sessions, mail, summarizer
        self.model_lock = model_lock
        self.paused = paused
        self.stopping = Event()
        self.wakeup = Event()
        self.threads = []
        self.error_code = ""
        # connection id -> monotonic time of its last backfill scan
        self.backfilled: dict[str, float] = {}

    def start(self) -> None:
        self.recover_pending()
        for target, name in (
            (self._detect_loop, "mail-detection"),
            (self._summary_loop, "mail-summary"),
        ):
            thread = Thread(target=target, name=name, daemon=True)
            thread.start()
            self.threads.append(thread)

    def recover_pending(self) -> None:
        with self.sessions() as db:
            db.execute(
                update(MailNotification)
                .where(MailNotification.status == "processing")
                .values(status="pending")
            )
            db.commit()
            mail_categories.recover(db)

    def stop(self) -> None:
        self.stopping.set()
        self.wakeup.set()
        for thread in self.threads:
            thread.join(timeout=3)

    def _detect_loop(self) -> None:
        while not self.stopping.is_set():
            self.error_code = ""
            try:
                self.poll_once()
            except Exception:
                self.error_code = "MAIL_MONITOR_FAILED"
            try:
                self.queue_backfill()
            except Exception:
                pass  # Categories are a convenience; the next scan tries again.
            self.wakeup.wait(15)
            self.wakeup.clear()

    def _summary_loop(self) -> None:
        while not self.stopping.is_set():
            try:
                worked = self.process_one()
            except Exception:
                # No traceback: third-party exception strings can contain private model input.
                worked = False
            self.stopping.wait(0.2 if worked else 1)

    def _connections(self) -> list[tuple[str, str, str]]:
        with self.sessions() as db:
            return [
                (row.id, row.user_id, row.email_address)
                for row in db.scalars(
                    select(EmailConnection)
                    .join(User)
                    .where(
                        User.is_active.is_(True),
                        EmailConnection.status == "connected",
                        EmailConnection.provider == "google",
                    )
                )
            ]

    def queue_backfill(self, every: float = BACKFILL_EVERY) -> None:
        """Queue each mailbox's received mail of the last days, and older notices, for labels."""
        for cid, owner, _ in self._connections():
            if self.stopping.is_set():
                return
            last = self.backfilled.get(cid)
            if last is not None and time.monotonic() - last < every:
                continue
            try:
                with self.sessions() as db:
                    _, token = self.mail.access(db, owner, cid)
                    db.rollback()
                ids: list[str] = []
                page_token = None
                for _ in range(BACKFILL_PAGES):
                    params = {
                        "maxResults": 100,
                        "includeSpamTrash": "false",
                        "q": (
                            f"newer_than:{mail_categories.BACKFILL_DAYS}d "
                            "-in:sent -in:drafts -in:trash"
                        ),
                    }
                    if page_token:
                        params["pageToken"] = page_token
                    result = self.mail.google.request(token, "messages", params)
                    ids.extend(item["id"] for item in result.get("messages", []))
                    page_token = result.get("nextPageToken")
                    if not page_token:
                        break
            except AuthError:
                continue  # The detection loop reports mailbox errors.
            with self.sessions() as db:
                # Notices saved before categories existed are relabelled too, whatever their age.
                notices = db.scalars(
                    select(MailNotification.message_id)
                    .where(
                        MailNotification.connection_id == cid,
                        MailNotification.user_id == owner,
                        MailNotification.dismissed.is_(False),
                    )
                    .order_by(MailNotification.received_at.desc())
                )
                mail_categories.queue(db, owner, cid, [*ids, *notices])
            self.backfilled[cid] = time.monotonic()

    def poll_once(self) -> None:
        with self.sessions() as db:
            connections = [
                (row.id, row.user_id, row.email_address)
                for row in db.scalars(
                    select(EmailConnection)
                    .join(User)
                    .where(
                        User.is_active.is_(True),
                        EmailConnection.status == "connected",
                        EmailConnection.provider == "google",
                    )
                )
            ]
        for cid, owner, mailbox in connections:
            if self.stopping.is_set():
                return
            try:
                self._poll_connection(cid, owner, mailbox)
            except Exception as exc:
                code = exc.code if isinstance(exc, AuthError) else "MAIL_MONITOR_FAILED"
                with self.sessions() as db:
                    updated = db.execute(
                        update(MailWatch)
                        .where(MailWatch.connection_id == cid, MailWatch.user_id == owner)
                        .values(error_code=code)
                    ).rowcount
                    db.commit()
                    if not updated:
                        self.error_code = "MAIL_MONITOR_FAILED"

    def _poll_connection(self, cid: str, owner: str, mailbox: str) -> None:
        with self.sessions() as db:
            watch = db.get(MailWatch, cid)
            if watch is None:
                initial = {"phase": "initialize", "after": int(time.time()) - 3600}
                watch = MailWatch(
                    connection_id=cid,
                    user_id=owner,
                    encrypted_state=self.mail.vault.encrypt(json.dumps(initial)),
                    last_checked_at=0,
                    error_code="",
                )
                db.add(watch)
                db.commit()
            state = json.loads(self.mail.vault.decrypt(watch.encrypted_state))
            last_checked = watch.last_checked_at
            _, token = self.mail.access(db, owner, cid)
            db.rollback()
        if state["phase"] == "initialize":
            initial_after = state["after"]
            history_id = str(self.mail.google.request(token, "profile")["historyId"])
            state = {
                "phase": "bootstrap",
                "history_id": history_id,
                "after": initial_after,
                "page_token": None,
            }
            with self.sessions() as db:
                if db.get(EmailConnection, cid) is None:
                    return
                watch = db.get(MailWatch, cid)
                if watch is None:
                    return
                watch.encrypted_state = self.mail.vault.encrypt(json.dumps(state))
                db.commit()
        if state["phase"] == "bootstrap":
            params = {
                "maxResults": 100,
                "includeSpamTrash": "false",
                "q": f"after:{state['after']} -in:sent -in:drafts -in:trash",
            }
            if state.get("page_token"):
                params["pageToken"] = state["page_token"]
            result = self.mail.google.request(token, "messages", params)
            ids = [item["id"] for item in result.get("messages", [])]
        else:
            params = {
                "maxResults": 100,
                "startHistoryId": state["history_id"],
                "historyTypes": "messageAdded",
            }
            if state.get("page_token"):
                params["pageToken"] = state["page_token"]
            try:
                result = self.mail.google.request(token, "history", params)
            except AuthError as exc:
                if exc.code != "MAIL_NOT_FOUND":
                    raise
                # Expired Gmail cursor: rescan from the last completed check, not the whole mailbox.
                state = {
                    "phase": "bootstrap",
                    "history_id": str(self.mail.google.request(token, "profile")["historyId"]),
                    "after": max(0, last_checked - 60),
                    "page_token": None,
                }
                self._save_watch(cid, owner, state, last_checked)
                return
            ids = [
                entry["message"]["id"]
                for record in result.get("history", [])
                for entry in record.get("messagesAdded", [])
            ]
        for message_id in dict.fromkeys(ids):
            if self.stopping.is_set():
                return
            self._enqueue(
                cid,
                owner,
                mailbox,
                token,
                message_id,
                state.get("after") if state["phase"] == "bootstrap" else None,
            )
        state["page_token"] = result.get("nextPageToken")
        if not state["page_token"]:
            if state["phase"] == "history":
                state["history_id"] = str(result["historyId"])
            state["phase"] = "history"
            last_checked = int(time.time())
        self._save_watch(cid, owner, state, last_checked)

    def _save_watch(self, cid: str, owner: str, state: dict, checked: int) -> None:
        if self.stopping.is_set():
            return
        with self.sessions() as db:
            db.execute(
                update(MailWatch)
                .where(MailWatch.connection_id == cid, MailWatch.user_id == owner)
                .values(
                    encrypted_state=self.mail.vault.encrypt(json.dumps(state)),
                    last_checked_at=checked,
                    error_code="",
                )
            )
            db.commit()

    def _enqueue(
        self,
        cid: str,
        owner: str,
        mailbox: str,
        token: str,
        message_id: str,
        minimum_received_at: int | None = None,
    ) -> None:
        with self.sessions() as db:
            connection = db.get(EmailConnection, cid)
            if not connection or connection.user_id != owner or connection.status != "connected":
                return
            if db.scalar(
                select(MailNotification.id).where(
                    MailNotification.connection_id == cid, MailNotification.message_id == message_id
                )
            ):
                return
        try:
            raw = self.mail.google.message(token, message_id)
        except AuthError as exc:
            if exc.code == "MAIL_NOT_FOUND":
                return
            raise
        if set(raw.get("labelIds", [])) & {"SENT", "DRAFT", "SPAM", "TRASH"}:
            return
        if (
            minimum_received_at is not None
            and int(raw["internalDate"]) // 1000 <= minimum_received_at
        ):
            return
        metadata = summary(raw, cid, mailbox).model_dump(mode="json")
        payload = self.mail.vault.encrypt(json.dumps({"mail": metadata, "summary": None}))
        with self.sessions() as db:
            connection = db.get(EmailConnection, cid)
            if not connection or connection.user_id != owner or connection.status != "connected":
                return
            db.execute(
                insert(MailNotification)
                .values(
                    id=str(uuid4()),
                    user_id=owner,
                    connection_id=cid,
                    message_id=message_id,
                    encrypted_payload=payload,
                    status="pending",
                    dismissed=False,
                    error_code="",
                    created_at=int(time.time()),
                    received_at=int(raw["internalDate"]) // 1000,
                )
                .on_conflict_do_nothing(index_elements=["connection_id", "message_id"])
            )
            db.commit()

    def process_one(self) -> bool:
        if self.paused() or not self.model_lock.acquire(blocking=False):
            return False
        notification_id = None
        try:
            with self.sessions() as db:
                row = db.scalar(
                    select(MailNotification)
                    .join(EmailConnection)
                    .join(User, User.id == MailNotification.user_id)
                    .where(
                        MailNotification.status == "pending",
                        MailNotification.dismissed.is_(False),
                        EmailConnection.status == "connected",
                        User.is_active.is_(True),
                    )
                    .order_by(MailNotification.received_at, MailNotification.id)
                    .limit(1)
                )
                if row is None:
                    # No new mail waiting: use the idle model to label older mail.
                    return self._classify_one()
                notification_id, owner, cid, mid = (
                    row.id,
                    row.user_id,
                    row.connection_id,
                    row.message_id,
                )
                claimed = db.execute(
                    update(MailNotification)
                    .where(
                        MailNotification.id == notification_id,
                        MailNotification.status == "pending",
                        MailNotification.dismissed.is_(False),
                    )
                    .values(status="processing")
                ).rowcount
                db.commit()
                if not claimed:
                    return False
            with self.sessions() as db:
                mail = self.mail.message(db, owner, cid, mid)
                # Summaries are written in the account's interface language.
                language = db.scalar(select(User.language).where(User.id == owner)) or "zh"
                db.rollback()
            result = self.summarizer.summarize(mail, language)
            self._finish(notification_id, result.summary.model_dump(mode="json"), "")
        except Exception as exc:
            code = (
                exc.code
                if isinstance(exc, AuthError)
                else str(exc)
                if isinstance(exc, SummaryError)
                else "SUMMARY_INTERNAL"
            )
            if notification_id:
                self._finish(notification_id, None, code)
        finally:
            self.model_lock.release()
        return notification_id is not None

    def _classify_one(self) -> bool:
        """Label one queued mail. Called with the model lock held."""
        with self.sessions() as db:
            row = mail_categories.claim_next(db)
            if row is None:
                return False
            row_id, owner, cid, mid = row.id, row.user_id, row.connection_id, row.message_id
        category, gone = None, False
        try:
            with self.sessions() as db:
                mail = self.mail.message(db, owner, cid, mid)
                db.rollback()
            category = self.summarizer.classify(mail)
        except AuthError as exc:
            gone = exc.code == "MAIL_NOT_FOUND"
        except Exception:
            pass  # Recorded as failed; retried by a later backfill scan.
        if not self.stopping.is_set():
            with self.sessions() as db:
                mail_categories.finish(db, row_id, category, gone)
        return True

    def _finish(self, notification_id: str, generated: dict | None, code: str) -> None:
        if self.stopping.is_set():
            return
        with self.sessions() as db:
            row = db.scalar(
                select(MailNotification)
                .join(EmailConnection)
                .join(User, User.id == MailNotification.user_id)
                .where(
                    MailNotification.id == notification_id,
                    MailNotification.dismissed.is_(False),
                    EmailConnection.status == "connected",
                    User.is_active.is_(True),
                )
            )
            if row is None:
                return
            payload = json.loads(self.mail.vault.decrypt(row.encrypted_payload))
            payload["summary"] = generated
            row.encrypted_payload = self.mail.vault.encrypt(json.dumps(payload))
            row.status = "ready" if generated else "failed"
            row.error_code = code
            if generated:
                # The summary's category (chosen after its overview) labels this mail everywhere.
                mail_categories.save_category(
                    db, row.user_id, row.connection_id, row.message_id, generated["category"]
                )
            db.commit()
