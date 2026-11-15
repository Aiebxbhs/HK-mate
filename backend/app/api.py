from collections.abc import Generator
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app import services
from app.core.security import CSRF_COOKIE, SESSION_COOKIE, create_csrf
from app.models import User
from app.schemas import (
    CsrfOutput,
    ErrorOutput,
    HealthOutput,
    LoginInput,
    PasswordChangeInput,
    RegisterInput,
    UserOutput,
)

router = APIRouter(
    prefix="/api/v1",
    responses={code: {"model": ErrorOutput} for code in (400, 401, 403, 409, 413, 422, 429, 500)},
)


def database(request: Request) -> Generator[Session, None, None]:
    with request.app.state.session_factory() as session:
        yield session


def output(user: User) -> UserOutput:
    return UserOutput(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        created_at=datetime.fromtimestamp(user.created_at, UTC),
    )


@router.get("/health", response_model=HealthOutput)
def health() -> dict[str, str]:
    return {"status": "ok", "service": "backend"}


@router.get("/auth/csrf", response_model=CsrfOutput)
def csrf(request: Request, response: Response) -> dict[str, str]:
    token = create_csrf(request.app.state.csrf_secret)
    response.set_cookie(
        CSRF_COOKIE,
        token,
        httponly=True,
        secure=request.app.state.settings.cookie_secure,
        samesite="lax",
        max_age=3600,
    )
    return {"csrf_token": token}


@router.post("/auth/register", response_model=UserOutput, status_code=201)
def register(data: RegisterInput, request: Request, db: Session = Depends(database)) -> UserOutput:
    services.check_rate_limit(db, "register", str(data.username), request.client.host)
    return output(services.register_user(db, data))


@router.post("/auth/login", response_model=UserOutput)
def login(
    data: LoginInput, request: Request, response: Response, db: Session = Depends(database)
) -> UserOutput:
    services.check_rate_limit(db, "login", str(data.username), request.client.host)
    user = services.authenticate(db, str(data.username), data.password)
    settings = request.app.state.settings
    token = services.start_session(
        db, user, settings.session_seconds, request.cookies.get(SESSION_COOKIE)
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_seconds,
    )
    return output(user)


@router.get("/users/me", response_model=UserOutput)
def me(request: Request, db: Session = Depends(database)) -> UserOutput:
    return output(services.current_user(db, request.cookies.get(SESSION_COOKIE)))


@router.post("/auth/password", status_code=204)
def change_password(
    data: PasswordChangeInput, request: Request, db: Session = Depends(database)
) -> Response:
    token = request.cookies.get(SESSION_COOKIE)
    user = services.current_user(db, token)
    # Keyed by account so a stolen session cannot guess the current password quickly.
    services.check_rate_limit(db, "password", user.id, request.client.host)
    services.change_password(db, user, data.current_password, data.new_password, token)
    return Response(status_code=204)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, db: Session = Depends(database)) -> Response:
    services.end_session(db, request.cookies.get(SESSION_COOKIE))
    response = Response(status_code=204)
    response.delete_cookie(
        SESSION_COOKIE,
        httponly=True,
        secure=request.app.state.settings.cookie_secure,
        samesite="lax",
    )
    return response
