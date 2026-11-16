import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


@dataclass
class Settings:
    auto_mail_enabled: bool = field(
        default_factory=lambda: os.environ.get("HKM_AUTO_MAIL_ENABLED", "true").lower() == "true"
    )
    # macOS Notification Center banner for each new mail (needs auto_mail_enabled).
    system_notifications: bool = field(
        default_factory=lambda: os.environ.get("HKM_SYSTEM_NOTIFICATIONS", "true").lower() == "true"
    )
    database_path: Path = field(
        default_factory=lambda: Path(
            os.environ.get("HKM_DATABASE_PATH", str(ROOT / "private-data/hkumate.sqlite3"))
        ).resolve()
    )
    cookie_secure: bool = field(
        default_factory=lambda: os.environ.get("HKM_COOKIE_SECURE", "false").lower() == "true"
    )
    allowed_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            os.environ.get(
                "HKM_ALLOWED_ORIGINS",
                "http://127.0.0.1:5173,http://localhost:5173,"
                "http://127.0.0.1:8000,http://localhost:8000",
            ).split(",")
        )
    )
    session_seconds: int = 7 * 24 * 60 * 60
    google_client_file: Path = field(
        default_factory=lambda: Path(
            os.environ.get(
                "HKM_GOOGLE_CLIENT_FILE", str(ROOT / "private-data/google-oauth-client.json")
            )
        ).resolve()
    )
    google_redirect_uri: str = field(
        default_factory=lambda: os.environ.get(
            "HKM_GOOGLE_REDIRECT_URI",
            "http://127.0.0.1:8000/api/v1/email-connections/google/callback",
        )
    )
    token_key_file: Path = field(
        default_factory=lambda: Path(
            os.environ.get("HKM_TOKEN_KEY_FILE", str(ROOT / "private-data/mail-token.key"))
        ).resolve()
    )
    web_url: str = field(
        default_factory=lambda: os.environ.get("HKM_WEB_URL", "http://127.0.0.1:5173")
    )
