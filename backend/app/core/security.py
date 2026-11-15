import hashlib
import hmac
import secrets
import time

from pwdlib import PasswordHash

password_hasher = PasswordHash.recommended()
DUMMY_HASH = password_hasher.hash("dummy-account-verification-only")
SESSION_COOKIE = "hkm_session"
CSRF_COOKIE = "hkm_csrf"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_csrf(secret: bytes) -> str:
    payload = f"{int(time.time())}.{secrets.token_urlsafe(32)}"
    signature = hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def valid_csrf(token: str, secret: bytes) -> bool:
    try:
        timestamp, nonce, signature = token.split(".")
        age = time.time() - int(timestamp)
        expected = hmac.new(secret, f"{timestamp}.{nonce}".encode(), hashlib.sha256).hexdigest()
        return 0 <= age <= 3600 and hmac.compare_digest(signature, expected)
    except (ValueError, TypeError):
        return False
