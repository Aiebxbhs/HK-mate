"""Demo instance for recording the intro video. Synthetic data only.

Runs the real app on http://127.0.0.1:8010 with a throw-away database and a fresh demo account.
The Gmail and 163 providers are replaced by in-memory mailboxes holding self-written mail, and
the HKU timetable link returns a self-written timetable, so no real mailbox, HKU account or
private data is touched. Summaries, categories, captions and drafts still come from the real
local models, and the assistant from the configured cloud provider.

Start it with video/run_demo.sh. Extra routes for the recording page:
  GET /__video/...        the director page (video/director)
  GET /__demo/state       demo account name and readiness of the mail labels
  GET /__demo/deliver     a new mail "arrives" in the demo Gmail mailbox
"""

import base64
import imaplib
import json
import os
import shutil
import sys
import time
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import uvicorn  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from app import calendar_api, netease, services  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import EmailConnection, MailCategoryRecord  # noqa: E402
from app.schemas import RegisterInput  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from icalendar import Calendar, Event  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

PORT = 8010
ORIGIN = f"http://127.0.0.1:{PORT}"
DATA = ROOT / "private-data/video-demo"
USERNAME, PASSWORD = "mia", "demo-password-for-video"
GMAIL, NETEASE = "mia.chan.demo@gmail.com", "mia_chan_demo@163.com"
HK = ZoneInfo("Asia/Hong_Kong")

# (sender, subject, body, hours ago). All self-written; names and addresses are made up.
GMAIL_MAIL = [
    (
        "COMP7503 Teaching Team <comp7503@cs.example.edu>",
        "Assignment 2 released – due 27 November",
        "Dear students,\n\nAssignment 2 on convolutional networks is now available on Moodle. "
        "Please submit your report (PDF, at most 6 pages) and your code by Friday 27 November, "
        "23:59. Late submissions lose 10% per day. Office hours this week are on Wednesday "
        "2–4 pm in CB 308.\n\nBest regards,\nCOMP7503 Teaching Team",
        3,
    ),
    (
        "Harbour Analytics Recruiting <talent@harbour-analytics.example>",
        "Interview invitation – Data Analyst Intern",
        "Hi Mia,\n\nThank you for applying for the Data Analyst Intern position. We would like "
        "to invite you to a 45-minute video interview next Tuesday at 3:00 pm (HKT). Please "
        "reply to confirm whether this time works for you, or suggest another slot.\n\n"
        "Kind regards,\nJoanne Lee\nTalent Acquisition, Harbour Analytics",
        7,
    ),
    (
        "Taught Postgraduate Office <tpg-office@example.edu>",
        "Reminder: course selection for Semester 2 opens on 1 December",
        "Dear students,\n\nCourse selection for Semester 2 opens on 1 December at 10:00 am and "
        "closes on 12 December. Please check the prerequisites of each course before you "
        "enrol. Contact the office if you need a study-plan review.\n\nTPG Office",
        26,
    ),
    (
        "CityLink Mobile <billing@citylink-mobile.example>",
        "Your November bill is ready – HK$128",
        "Dear customer,\n\nYour mobile bill for November is HK$128.00. The amount will be "
        "charged to your registered card on 25 November. You can view the itemised bill in "
        "the CityLink app.\n\nCityLink Mobile",
        30,
    ),
    (
        "Study Group <kevin.wong.demo@example.com>",
        "Group project meeting this Friday?",
        "Hi all,\n\nCan we meet this Friday at 3 pm in the Learning Commons to split the work "
        "for the DASC7606 group project? I can book a discussion room if everyone is free. "
        "Please let me know by Wednesday.\n\nKevin",
        49,
    ),
    (
        "Campus Books <news@campus-books.example>",
        "20% off all textbooks this weekend",
        "This weekend only: 20% off all textbooks and stationery in store and online. "
        "Use code STUDY20 at checkout. Offer ends Sunday.",
        54,
    ),
]
NETEASE_MAIL = [
    (
        "港大内地学生联谊会 <mainland-society@example.org>",
        "周六迎新聚餐报名",
        "各位同学好：\n\n本周六晚 6 点半在西环举办迎新聚餐，费用每人 120 港币，"
        "请在周四前回复本邮件报名，并注明是否有忌口。期待见到大家！\n\n联谊会",
        5,
    ),
    (
        "招银香港 <notice@bank-demo.example>",
        "您的账户月结单已生成",
        "尊敬的客户：\n\n您 10 月的账户月结单已生成，请登录网上银行查看。"
        "如对账单有疑问，请在 60 天内联系客服。\n\n招银香港",
        28,
    ),
    (
        "陈老师 <chen.laoshi.demo@example.com>",
        "推荐信材料请于下周三前发我",
        "同学你好：\n\n推荐信我可以帮你写。请在下周三前把简历、成绩单和申请项目列表发给我，"
        "并说明每个项目的截止日期。\n\n陈老师",
        50,
    ),
    (
        "优选旅行 <promo@travel-demo.example>",
        "圣诞假期机票特惠，低至 5 折",
        "圣诞假期出行特惠开启：香港往返多个城市机票低至 5 折，酒店套餐同步优惠，"
        "活动截至 11 月 30 日。",
        60,
    ),
]
NEW_MAIL = (
    "Dr. Alan Fong <alan.fong.demo@cs.example.edu>",
    "Thursday's lecture moved to LE2",
    "Dear all,\n\nThis Thursday's COMP7503 lecture (19:00–21:50) will be held in LE2 instead "
    "of MWT1 because of maintenance. The quiz planned for that day will still take place in "
    "the first 20 minutes, so please arrive on time.\n\nBest,\nAlan",
)

# (code, class section, course name, weekday Monday=0, start hour, start minute, room)
COURSES = [
    ("COMP7503", "1A", "Computational Intelligence and Machine Learning", 3, 19, 0, "MWT1"),
    ("DASC7606", "1B", "Data Visualization", 1, 19, 0, "CPD-LG.07"),
    ("COMP7607", "1A", "Natural Language Processing", 4, 14, 30, "LE1"),
    ("STAT7008", "1A", "Statistical Learning", 0, 9, 30, "KKL-201"),
]
EXAMS = [
    ("COMP7503", "1A", 9, 18, 30),
    ("DASC7606", "1B", 11, 14, 30),
    ("STAT7008", "1A", 15, 9, 30),
]


# The developer's own timetable, exported from the local database on request so the import shown
# in the film is a real one (private-data is not in Git). Without it a self-written one is used.
REAL_TIMETABLE = ROOT / "private-data/video-timetable.json"


def timetable() -> bytes:
    """The timetable the demo "HKU link" returns, in the shape of the HKU Event Calendar feed."""
    calendar = Calendar()
    calendar.add("prodid", "-//HK Mate demo//EN")
    calendar.add("version", "2.0")
    if REAL_TIMETABLE.is_file():
        for index, row in enumerate(json.loads(REAL_TIMETABLE.read_text())):
            event = Event()
            event.add("uid", f"demo-real-{index}@hkmate")
            event.add("summary", row["title"])
            event.add("dtstart", datetime.fromtimestamp(row["starts_at"], HK))
            event.add("dtend", datetime.fromtimestamp(row["ends_at"], HK))
            event.add("location", row["location"])
            event.add("description", row["description"])
            calendar.add_component(event)
        return calendar.to_ical()
    names = {code: name for code, _, name, *_ in COURSES}
    first = datetime(2026, 8, 31, tzinfo=HK)  # a Monday
    for code, section, name, weekday, hour, minute, room in COURSES:
        for week in range(13):
            start = first + timedelta(weeks=week, days=weekday, hours=hour, minutes=minute)
            if 6 <= week <= 6:  # reading week
                continue
            event = Event()
            event.add("uid", f"demo-{code}-{week}@hkmate")
            event.add("summary", f"{code} {section}")
            event.add("dtstart", start)
            event.add("dtend", start + timedelta(hours=2, minutes=50))
            event.add("location", room)
            event.add("description", f"{name} ({code}-{section}) LEC")
            calendar.add_component(event)
    for code, section, day, hour, minute in EXAMS:
        start = datetime(2026, 12, day, hour, minute, tzinfo=HK)
        event = Event()
        event.add("uid", f"demo-exam-{code}@hkmate")
        event.add("summary", f"{code} {section} Examination")
        event.add("dtstart", start)
        event.add("dtend", start + timedelta(hours=2))
        event.add("location", "Main Building 218")
        event.add("description", f"{names[code]} ({code}-{section}) Examination")
        calendar.add_component(event)
    return calendar.to_ical()


class DemoGmail:
    """Stands in for the Gmail API: a fixed inbox, plus mail delivered while recording."""

    def __init__(self) -> None:
        now = time.time()
        self.mail = {
            f"g{index}": (sender, subject, body, now - hours * 3600)
            for index, (sender, subject, body, hours) in enumerate(GMAIL_MAIL)
        }
        self.history: list[str] = []

    def deliver(self) -> str:
        message_id = f"new{len(self.history)}"
        self.mail[message_id] = (*NEW_MAIL, time.time())
        self.history.append(message_id)
        return message_id

    def ordered(self) -> list[str]:
        return sorted(self.mail, key=lambda key: self.mail[key][3], reverse=True)

    def refresh(self, serialized: str) -> tuple[str, str]:
        return "demo-token", serialized

    def configured(self) -> bool:
        return True

    def page(self, token: str, cursor: str | None, scope: str) -> dict:
        return {"messages": [{"id": key} for key in self.ordered()]}

    def message(self, token: str, message_id: str, full: bool = False) -> dict:
        if message_id not in self.mail:
            raise services.AuthError("MAIL_NOT_FOUND", "邮件不存在或已从 Gmail 移除。", 404)
        sender, subject, body, received = self.mail[message_id]
        return {
            "id": message_id,
            "internalDate": str(int(received * 1000)),
            "labelIds": ["INBOX", "UNREAD"] if message_id.startswith("new") else ["INBOX"],
            "snippet": " ".join(body.split())[:140],
            "payload": {
                "mimeType": "text/plain",
                "headers": [
                    {"name": "Subject", "value": subject},
                    {"name": "From", "value": sender},
                    {"name": "To", "value": GMAIL},
                ],
                "body": {"data": base64.urlsafe_b64encode(body.encode()).decode()},
            },
        }

    def request(self, token: str, path: str, params: dict | None = None) -> dict:
        if path == "profile":
            return {"historyId": "100", "emailAddress": GMAIL}
        if path == "messages":
            return {"messages": [{"id": key} for key in self.ordered()]}
        if path == "history":
            return {
                "historyId": str(100 + len(self.history)),
                "history": [{"messagesAdded": [{"message": {"id": key}} for key in self.history]}],
            }
        raise services.AuthError("MAIL_PROVIDER_UNAVAILABLE", "暂时无法读取 Gmail。", 502)


class DemoImap:
    """Stands in for imap.163.com with a fixed inbox."""

    def __init__(self) -> None:
        self.mail = {}
        for uid, (sender, subject, body, hours) in enumerate(NETEASE_MAIL, start=1):
            message = EmailMessage()
            message["Subject"], message["From"], message["To"] = subject, sender, NETEASE
            message.set_content(body)
            self.mail[uid] = (time.time() - hours * 3600, message.as_bytes())

    def connect(self, host, port, timeout=None):
        return self

    def login(self, address, code):
        return "OK", []

    def xatom(self, name, *args):
        return "OK", [b""]

    def select(self, folder, readonly=False):
        return "OK", [b"1"]

    def response(self, code):
        return code, [b"1"]

    def logout(self):
        return "BYE", []

    def uid(self, command_name, *args):
        uids = sorted(self.mail)
        if command_name == "SEARCH":
            criteria = [arg for arg in args if arg is not None]
            if criteria[0] == "UID":
                low = int(criteria[1].split(":")[0])
                uids = [uid for uid in uids if uid >= low] or uids[-1:]
            return "OK", [" ".join(map(str, uids)).encode()]
        data = []
        for uid in map(int, args[0].split(",")):
            received, raw = self.mail[uid]
            date = imaplib.Time2Internaldate(received)
            data.append((f"1 (UID {uid} INTERNALDATE {date} BODY[]<0> {{9}}".encode(), raw))
            data.append(b" FLAGS (\\Seen))")
        return "OK", data


def main() -> None:
    # HKM_DEMO_KEEP=1 reopens the data of the last run (for looking around and screenshots)
    # instead of starting from an empty account.
    keep = os.environ.get("HKM_DEMO_KEEP") == "1" and (DATA / "demo.sqlite3").is_file()
    if not keep:
        shutil.rmtree(DATA, ignore_errors=True)
        DATA.mkdir(parents=True)
    database = DATA / "demo.sqlite3"
    os.environ["HKM_DATABASE_PATH"] = str(database)
    command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
    client_file = DATA / "google.json"
    client_file.write_text("{}")
    settings = Settings(
        auto_mail_enabled=False,  # started below, after the providers are replaced
        system_notifications=False,
        database_path=database,
        allowed_origins=(ORIGIN,),
        google_client_file=client_file,
        token_key_file=DATA / "mail-token.key",
        web_url=ORIGIN,
    )
    app = create_app(settings)
    mail = app.state.mail
    gmail = DemoGmail()
    for name in ("refresh", "configured", "page", "message", "request"):
        setattr(mail.google, name, getattr(gmail, name))
    mail.netease.imap = DemoImap().connect
    calendar_api.fetch_hku_feed = lambda url: timetable()

    if not keep:
        with app.state.session_factory() as db:
            user = services.register_user(db, RegisterInput(username=USERNAME, password=PASSWORD))
            mail.vault.cipher(create=True)
            for provider, address, secret in (
                ("google", GMAIL, "{}"),
                (netease.PROVIDER, NETEASE, netease.credentials(NETEASE, "DEMOCODE12345678")),
            ):
                db.add(
                    EmailConnection(
                        id=str(uuid4()),
                        user_id=user.id,
                        provider=provider,
                        email_address=address,
                        encrypted_credentials=mail.vault.encrypt(secret),
                        status="connected",
                        created_at=int(time.time()),
                    )
                )
            db.commit()

    monitor = app.state.monitor
    # Switched on only now, so the app's own start-up runs the monitor with the demo mailboxes.
    settings.auto_mail_enabled = True

    if keep:
        # The mail that "arrived" during the last run exists again, so its notice can be opened.
        gmail.deliver()

    @app.get("/__demo/state", include_in_schema=False)
    def state():
        with app.state.session_factory() as db:
            labels = dict(
                db.execute(
                    select(MailCategoryRecord.status, func.count()).group_by(
                        MailCategoryRecord.status
                    )
                ).all()
            )
        return {
            "username": USERNAME,
            "password": PASSWORD,
            "labels": labels,
            "now": datetime.now(UTC).isoformat(),
        }

    @app.get("/__demo/deliver", include_in_schema=False)
    def deliver():
        message_id = gmail.deliver()
        monitor.wakeup.set()
        return {"id": message_id}

    app.mount("/__video", StaticFiles(directory=ROOT / "video/director", html=True))
    uvicorn.run(app, host="127.0.0.1", port=PORT, access_log=False, proxy_headers=False)


if __name__ == "__main__":
    print(json.dumps({"demo": ORIGIN, "data": str(DATA)}))
    main()
