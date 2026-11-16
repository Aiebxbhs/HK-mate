"""macOS Notification Center banners for new mail. Text is never logged."""

import subprocess
import sys
from email.utils import parseaddr

# Mail text reaches AppleScript only as arguments (argv), never as script source.
SCRIPT = (
    "on run argv\n"
    "display notification (item 3 of argv) with title (item 1 of argv) "
    "subtitle (item 2 of argv)\n"
    "end run\n"
)


def clean(text: str, limit: int) -> str:
    """One line of printable text, shortened to what a banner can show."""
    line = " ".join("".join(ch if ch.isprintable() else " " for ch in text).split())
    return line if len(line) <= limit else line[: limit - 1] + "…"


def sender_name(sender: str) -> str:
    name, address = parseaddr(sender)
    return name or address or sender


def notify(title: str, subtitle: str, body: str) -> None:
    """Show one banner; does nothing off macOS and never raises."""
    if sys.platform != "darwin":
        return
    try:
        subprocess.run(
            [
                "/usr/bin/osascript",
                "-",
                clean(title, 80),
                clean(subtitle, 120),
                clean(body, 300),
            ],
            input=SCRIPT.encode(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
    except Exception:
        pass  # A missed banner must not break mail processing; the page still shows the mail.
