"""Import a private local ICS file for exactly one existing user; never print event contents."""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.calendar_service import parse_hku_calendar, replace_hku_events  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.core.database import create_database  # noqa: E402
from app.models import EmailConnection, User  # noqa: E402
from app.services import AuthError  # noqa: E402
from sqlalchemy import select  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, required=True)
    parser.add_argument("--username")
    args = parser.parse_args()
    engine, sessions = create_database(Settings())
    try:
        events = parse_hku_calendar(args.file.read_bytes())
        with sessions() as db:
            query = select(User).where(User.is_active.is_(True))
            if args.username:
                query = query.where(User.username == args.username.strip().lower())
            else:
                query = query.where(User.id.in_(select(EmailConnection.user_id)))
            owners = list(db.scalars(query))
            if len(owners) != 1:
                print("Select exactly one calendar owner with --username.")
                return 1
            count = replace_hku_events(db, owners[0].id, events)
        print(f"Imported {count} HKU events for one account. No subscription URL stored.")
        return 0
    except AuthError as exc:
        print(f"Import stopped: {exc.code}")
        return 1
    except OSError:
        print("Private ICS file unavailable.")
        return 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
