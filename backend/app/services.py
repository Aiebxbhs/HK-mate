import secrets
import time
from uuid import uuid4

from sqlalchemy import case, delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import DUMMY_HASH, hash_token, password_hasher
from app.models import AuthRateLimit, LoginSession, User
from app.schemas import RegisterInput


class AuthError(Exception):
    def __init__(self, code: str, message: str, status: int):
        self.code, self.message, self.status = code, message, status


def check_rate_limit(db: Session, action: str, username: str, client: str) -> None:
    """Atomically count attempts in persistent, fixed 15-minute windows."""
    now = int(time.time())
    window = now // 900 * 900
    buckets = [(f"{action}:ip:{hash_token(client)}", 40)]
    buckets.append((f"{action}:username:{hash_token(username)}", 10 if action == "login" else 5))
    blocked = False
    db.execute(delete(AuthRateLimit).where(AuthRateLimit.window_started_at < window - 900))
    for key, limit in buckets:
        statement = insert(AuthRateLimit).values(
            bucket_key=key, window_started_at=window, attempt_count=1, blocked_until=window + 900
        )
        statement = statement.on_conflict_do_update(
            index_elements=[AuthRateLimit.bucket_key],
            set_={
                "window_started_at": window,
                "attempt_count": case(
                    (AuthRateLimit.window_started_at == window, AuthRateLimit.attempt_count + 1),
                    else_=1,
                ),
                "blocked_until": window + 900,
            },
        ).returning(AuthRateLimit.attempt_count)
        blocked = db.execute(statement).scalar_one() > limit or blocked
    db.commit()
    if blocked:
        raise AuthError("RATE_LIMITED", "尝试次数过多，请稍后再试。", 429)


def register_user(db: Session, data: RegisterInput) -> User:
    now = int(time.time())
    user = User(
        id=str(uuid4()),
        username=str(data.username),
        display_name=data.username,
        password_hash=password_hasher.hash(data.password),
        language=data.language,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AuthError(
            "REGISTRATION_UNAVAILABLE", "无法使用这些信息注册，请尝试登录。", 409
        ) from None
    return user


def authenticate(db: Session, username: str, password: str) -> User:
    user = db.scalar(select(User).where(User.username == username))
    valid = password_hasher.verify(password, user.password_hash if user else DUMMY_HASH)
    if not user or not valid or not user.is_active:
        raise AuthError("INVALID_CREDENTIALS", "账号或密码不正确。", 401)
    return user


def start_session(db: Session, user: User, duration: int, previous_token: str | None) -> str:
    now = int(time.time())
    db.execute(delete(LoginSession).where(LoginSession.expires_at <= now))
    if previous_token:
        db.execute(
            delete(LoginSession).where(LoginSession.token_hash == hash_token(previous_token))
        )
    token = secrets.token_urlsafe(48)
    db.add(
        LoginSession(
            id=str(uuid4()),
            user_id=user.id,
            token_hash=hash_token(token),
            created_at=now,
            expires_at=now + duration,
        )
    )
    db.commit()
    return token


def current_user(db: Session, token: str | None) -> User:
    user = None
    if token and len(token) <= 128:
        user = db.scalar(
            select(User)
            .join(LoginSession)
            .where(
                LoginSession.token_hash == hash_token(token),
                LoginSession.expires_at > int(time.time()),
                User.is_active.is_(True),
            )
        )
    if user is None:
        raise AuthError("AUTHENTICATION_REQUIRED", "登录已过期，请重新登录。", 401)
    return user


def change_password(
    db: Session, user: User, current_password: str, new_password: str, token: str | None
) -> None:
    """Replace the password and sign out every other device; this session stays signed in."""
    if not password_hasher.verify(current_password, user.password_hash):
        raise AuthError("INVALID_CURRENT_PASSWORD", "当前密码不正确。", 400)
    if password_hasher.verify(new_password, user.password_hash):
        raise AuthError("PASSWORD_UNCHANGED", "新密码不能与当前密码相同。", 400)
    user.password_hash = password_hasher.hash(new_password)
    user.updated_at = int(time.time())
    db.execute(
        delete(LoginSession).where(
            LoginSession.user_id == user.id,
            LoginSession.token_hash != hash_token(token or ""),
        )
    )
    db.commit()


def end_session(db: Session, token: str | None) -> None:
    if token:
        db.execute(delete(LoginSession).where(LoginSession.token_hash == hash_token(token)))
        db.commit()
