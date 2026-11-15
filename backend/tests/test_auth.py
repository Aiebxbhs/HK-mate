import hashlib
import time

from alembic import command
from alembic.config import Config
from app.core.config import ROOT, Settings
from app.core.security import SESSION_COOKIE, hash_token, password_hasher
from app.main import create_app
from app.models import LoginSession, User
from fastapi.testclient import TestClient
from sqlalchemy import select, update

PASSWORD = "example-password-for-tests"
ORIGIN = "http://testserver"


def post(client, path, body=None, origin=ORIGIN):
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    return client.post(path, json=body or {}, headers={"Origin": origin, "X-CSRF-Token": csrf})


def register(client, username="student_01", password=PASSWORD):
    return post(
        client,
        "/api/v1/auth/register",
        {
            "username": username,
            "password": password,
        },
    )


def login(client, username="student_01", password=PASSWORD):
    return post(client, "/api/v1/auth/login", {"username": username, "password": password})


def test_full_lifecycle_and_revocation(client):
    assert client.get("/api/v1/users/me").status_code == 401
    registered = register(client)
    assert registered.status_code == 201
    assert set(registered.json()) == {"id", "username", "display_name", "created_at"}
    assert registered.json()["created_at"].endswith("Z")
    assert client.get("/api/v1/users/me").status_code == 401
    logged_in = login(client)
    assert logged_in.status_code == 200
    cookie = logged_in.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie
    raw_token = client.cookies.get(SESSION_COOKIE)
    assert client.get("/api/v1/users/me").json()["id"] == registered.json()["id"]
    with client.app.state.session_factory() as db:
        assert db.scalar(select(User)).password_hash.startswith("$argon2id$")
        assert (
            db.scalar(select(LoginSession)).token_hash
            == hashlib.sha256(raw_token.encode()).hexdigest()
        )
    assert post(client, "/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/users/me").status_code == 401
    client.cookies.set(SESSION_COOKIE, raw_token)
    assert client.get("/api/v1/users/me").status_code == 401


def test_duplicate_normalized_username_and_validation(client):
    assert register(client, "Student_01").status_code == 201
    assert register(client, "student_01").status_code == 409
    assert register(client, "bad@account").status_code == 422
    assert register(client, password="short").status_code == 422
    response = post(
        client,
        "/api/v1/auth/register",
        {
            "username": "new_student",
            "password": PASSWORD,
            "display_name": "   ",
            "user_id": "other",
        },
    )
    assert response.status_code == 422
    assert PASSWORD not in response.text
    assert register(client, "ab").status_code == 422
    assert register(client, "x" * 33).status_code == 422
    assert login(client, " STUDENT_01 ").status_code == 200


def test_credentials_fail_uniformly(client):
    register(client)
    wrong = login(client, password="incorrect-password")
    missing = login(client, username="absent_user")
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json()["error"]["code"] == missing.json()["error"]["code"]
    assert client.cookies.get(SESSION_COOKIE) is None


def test_expired_and_disabled_sessions(client):
    register(client)
    login(client)
    with client.app.state.session_factory() as db:
        db.execute(update(LoginSession).values(expires_at=int(time.time()) - 1))
        db.commit()
    assert client.get("/api/v1/users/me").status_code == 401
    login(client)
    with client.app.state.session_factory() as db:
        db.execute(update(User).values(is_active=False))
        db.commit()
    assert client.get("/api/v1/users/me").status_code == 401
    assert login(client).status_code == 401


def test_csrf_and_origin_enforced(client):
    assert client.post("/api/v1/auth/register", json={}).status_code == 403
    assert register(client).status_code == 201
    assert (
        post(client, "/api/v1/auth/logout", origin="https://untrusted.example").status_code == 403
    )
    assert (
        client.post(
            "/api/v1/auth/logout", headers={"Origin": ORIGIN, "X-CSRF-Token": "forged"}
        ).status_code
        == 403
    )


def test_user_sessions_are_isolated(client):
    register(client, "first_user")
    register(client, "second_user")
    login(client, "first_user")
    first_token = client.cookies.get(SESSION_COOKIE)
    with TestClient(client.app) as second:
        login(second, "second_user")
        assert second.get("/api/v1/users/me").json()["username"] == "second_user"
        assert client.get("/api/v1/users/me").json()["username"] == "first_user"
        post(second, "/api/v1/auth/logout")
    assert client.get("/api/v1/users/me").status_code == 200
    assert client.cookies.get(SESSION_COOKIE) == first_token


def test_rate_limit_survives_new_app_instance(client):
    for _ in range(10):
        assert login(client).status_code == 401
    assert login(client).status_code == 429
    app = create_app(client.app.state.settings)
    with TestClient(app) as other:
        assert login(other).status_code == 429


def test_session_survives_app_restart(client):
    register(client)
    login(client)
    app = create_app(client.app.state.settings)
    with TestClient(app) as other:
        other.cookies.set(SESSION_COOKIE, client.cookies.get(SESSION_COOKIE))
        assert other.get("/api/v1/users/me").status_code == 200


def test_body_limit_errors_and_unknown_route(client):
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    response = client.post(
        "/api/v1/auth/login", content="x" * 17000, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf}
    )
    assert response.status_code == 413
    assert client.get("/api/v1/nonexistent").status_code == 404
    assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]
    assert response.headers["Cache-Control"] == "no-store"


def test_migration_and_sqlite_settings(client):
    with client.app.state.engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert connection.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar()
    assert client.get("/api/v1/health").json() == {"status": "ok", "service": "backend"}


def test_existing_email_accounts_and_sessions_survive_migration(tmp_path, monkeypatch):
    database = tmp_path / "legacy.sqlite3"
    monkeypatch.setenv("HKM_DATABASE_PATH", str(database))
    config = Config(str(ROOT / "alembic.ini"))
    command.upgrade(config, "541e8663222b")
    import sqlite3

    now = int(time.time())
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "legacy-user",
                "legacy@example.com",
                "Old User",
                password_hasher.hash(PASSWORD),
                True,
                now,
                now,
            ),
        )
        connection.execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
            ("legacy-session", "legacy-user", hash_token("old-session-token"), now, now + 3600),
        )
    command.upgrade(config, "head")
    app = create_app(Settings(database_path=database, allowed_origins=(ORIGIN,)))
    with TestClient(app) as client:
        client.cookies.set(SESSION_COOKIE, "old-session-token")
        response = client.get("/api/v1/users/me")
        assert response.status_code == 200
        assert response.json()["username"] == "legacy@example.com"
        assert login(client, "legacy@example.com").status_code == 200


NEW_PASSWORD = "another-example-password"


def change_password(client, current=PASSWORD, new=NEW_PASSWORD, origin=ORIGIN):
    return post(
        client,
        "/api/v1/auth/password",
        {"current_password": current, "new_password": new},
        origin=origin,
    )


def test_change_password_requires_login_and_csrf(client):
    assert change_password(client).status_code == 401
    register(client)
    login(client)
    assert change_password(client, origin="https://untrusted.example").status_code == 403
    assert login(client).status_code == 200


def test_change_password_signs_out_other_devices_only(client):
    register(client)
    login(client)
    with TestClient(client.app) as other:
        login(other)
        response = change_password(client)
        assert response.status_code == 204
        assert other.get("/api/v1/users/me").status_code == 401
    assert client.get("/api/v1/users/me").status_code == 200
    assert login(client).status_code == 401
    assert login(client, password=NEW_PASSWORD).status_code == 200
    with client.app.state.session_factory() as db:
        assert db.scalar(select(User)).password_hash.startswith("$argon2id$")


def test_change_password_rejects_wrong_same_and_short_passwords(client):
    register(client)
    login(client)
    wrong = change_password(client, current="incorrect-password")
    assert wrong.status_code == 400
    assert wrong.json()["error"]["code"] == "INVALID_CURRENT_PASSWORD"
    same = change_password(client, new=PASSWORD)
    assert same.json()["error"]["code"] == "PASSWORD_UNCHANGED"
    short = change_password(client, new="tiny-pass")
    assert short.status_code == 422
    assert "tiny-pass" not in short.text and PASSWORD not in short.text
    extra = post(
        client,
        "/api/v1/auth/password",
        {"current_password": PASSWORD, "new_password": NEW_PASSWORD, "user_id": "other"},
    )
    assert extra.status_code == 422
    assert client.get("/api/v1/users/me").status_code == 200
    assert login(client).status_code == 200


def test_change_password_only_affects_own_account(client):
    register(client, "first_user")
    register(client, "second_user")
    login(client, "first_user")
    assert change_password(client).status_code == 204
    with TestClient(client.app) as second:
        assert login(second, "second_user").status_code == 200


def test_change_password_is_rate_limited(client):
    register(client)
    login(client)
    for _ in range(5):
        assert change_password(client, current="incorrect-password").status_code == 400
    assert change_password(client).status_code == 429
    assert login(client).status_code == 200


def test_built_frontend_serves_public_files(client):
    dist = ROOT / "frontend/dist"
    if not (dist / "index.html").is_file():
        import pytest

        pytest.skip("frontend not built")
    worklet = client.get("/pcm-capture-worklet.js")
    assert worklet.status_code == 200
    assert worklet.headers["content-type"].startswith("text/javascript")
    image = client.get("/guide/timetable-help/step-1.webp")
    assert image.status_code == 200 and image.headers["content-type"] == "image/webp"
    assert client.get("/guide/missing.webp").status_code == 404
