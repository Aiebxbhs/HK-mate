import asyncio
import hmac
import json
import logging
import secrets
import time
from contextlib import asynccontextmanager
from threading import Lock
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from app.agent.api import RateLimiter
from app.agent.api import router as agent_router
from app.agent.models import create_model
from app.agent.places import DailyLimit
from app.agent.providers import AgentSettings, google_maps_key
from app.api import router
from app.calendar_api import router as calendar_router
from app.core.config import ROOT, Settings
from app.core.database import create_database
from app.core.security import CSRF_COOKIE, valid_csrf
from app.gmail import GoogleMailbox, TokenVault
from app.guide_api import router as guide_router
from app.i18n import request_language, tr
from app.lecture_api import router as lecture_router
from app.lecture_api import summary_router as lecture_summary_router
from app.lecture_stream import LiveLectures, QwenTranslator, WhisperRecognizer
from app.lecture_stream import router as lecture_stream_router
from app.lecture_summary import LectureSummarizer
from app.mail_api import router as mail_router
from app.mail_monitor import MailMonitor
from app.mail_reply import LocalReplyDrafter
from app.mail_service import MailService
from app.mail_summary import LocalMailSummarizer
from app.notification_api import router as notification_router
from app.services import AuthError
from app.weather import WeatherService

logger = logging.getLogger("hkumate")


def error(request: Request, status: int, code: str, message: str, details=None) -> JSONResponse:
    payload = {
        "code": code,
        "message": tr(message, request_language(request)),
        "request_id": request.state.request_id,
    }
    if details is not None:
        payload["details"] = details
    headers = {"Retry-After": "900"} if status == 429 else {}
    return JSONResponse({"error": payload}, status_code=status, headers=headers)


DEFAULT_BODY_LIMIT = 16_384
# Whole-lecture transcripts (up to 20,000 lines) and chat histories need more room.
BODY_LIMITS = {
    "/api/v1/lecture-summaries": 4 * 1024 * 1024,
    "/api/v1/lecture-records": 4 * 1024 * 1024,
    "/api/v1/agent/chat": 128 * 1024,
}


def body_limit(path: str) -> int:
    for prefix, limit in BODY_LIMITS.items():
        if path == prefix or path.startswith(prefix + "/"):
            return limit
    return DEFAULT_BODY_LIMIT


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine, factory = create_database(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            if settings.auto_mail_enabled:
                app.state.monitor.start()
            yield
        finally:
            if settings.auto_mail_enabled:
                await asyncio.to_thread(app.state.monitor.stop)
            engine.dispose()

    app = FastAPI(title="HK Mate API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = factory
    app.state.csrf_secret = secrets.token_bytes(32)
    app.state.weather = WeatherService()
    # Cloud model for the home-page assistant; read from HKM_AGENT_* (key never logged).
    app.state.agent_settings = AgentSettings.from_env()
    app.state.agent_model_factory = lambda: create_model(app.state.agent_settings)
    app.state.agent_limiter = RateLimiter()
    app.state.google_maps_key = google_maps_key()
    app.state.places_limit = DailyLimit()
    app.state.mail = MailService(GoogleMailbox(settings), TokenVault(settings))
    app.state.summarizer = LocalMailSummarizer()
    app.state.reply_drafter = LocalReplyDrafter()
    app.state.summary_lock = Lock()
    app.state.live_lectures = LiveLectures()
    app.state.lecture_recognizer = WhisperRecognizer()
    app.state.lecture_translator = QwenTranslator(app.state.summary_lock)
    app.state.lecture_summarizer = LectureSummarizer(app.state.summary_lock)
    app.state.monitor = MailMonitor(
        factory,
        app.state.mail,
        app.state.summarizer,
        app.state.summary_lock,
        # Live captions come first; background summaries wait until recording stops.
        paused=app.state.live_lectures.active,
    )

    @app.middleware("http")
    async def security_boundary(request: Request, call_next):
        request.state.request_id = str(uuid4())
        started = time.monotonic()
        try:
            if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
                cookie = request.cookies.get(CSRF_COOKIE, "")
                header = request.headers.get("x-csrf-token", "")
                origin = request.headers.get("origin", "")
                if origin not in settings.allowed_origins or not (
                    cookie
                    and header
                    and len(header) <= 256
                    and cookie.isascii()
                    and header.isascii()
                    and hmac.compare_digest(cookie, header)
                    and valid_csrf(header, app.state.csrf_secret)
                ):
                    response = error(
                        request, 403, "CSRF_REJECTED", "请求验证已失效，请刷新后重试。"
                    )
                else:
                    limit = body_limit(request.url.path)
                    chunks, size = [], 0
                    async for chunk in request.stream():
                        size += len(chunk)
                        if size > limit:
                            break
                        chunks.append(chunk)
                    if size > limit:
                        response = error(request, 413, "REQUEST_TOO_LARGE", "请求内容过大。")
                    else:
                        request._body = b"".join(chunks)
                        response = await call_next(request)
            else:
                response = await call_next(request)
        except Exception:
            logger.exception(
                json.dumps({"event": "request_failed", "request_id": request.state.request_id})
            )
            response = error(request, 500, "INTERNAL_ERROR", "服务暂时不可用，请稍后重试。")
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers["Cache-Control"] = "no-store"
        logger.info(
            json.dumps(
                {
                    "event": "request_completed",
                    "request_id": request.state.request_id,
                    "method": request.method,
                    "status": response.status_code,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                }
            )
        )
        return response

    @app.exception_handler(AuthError)
    async def auth_error(request: Request, exc: AuthError):
        return error(request, exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        details = [{"field": str(e["loc"][-1]), "reason": e["type"]} for e in exc.errors()]
        return error(request, 422, "VALIDATION_ERROR", "请检查填写的信息。", details)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return error(request, exc.status_code, "HTTP_ERROR", "请求无法完成。")

    app.include_router(router)
    app.include_router(mail_router)
    app.include_router(notification_router)
    app.include_router(calendar_router)
    app.include_router(lecture_router)
    app.include_router(lecture_stream_router)
    app.include_router(lecture_summary_router)
    app.include_router(agent_router)
    app.include_router(guide_router)
    frontend = ROOT / "frontend/dist"
    if (frontend / "index.html").is_file():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")
        # Files copied from frontend/public: tutorial images, campus map, audio worklet.
        if (frontend / "guide").is_dir():
            app.mount("/guide", StaticFiles(directory=frontend / "guide"), name="guide")

        @app.get("/favicon.svg", include_in_schema=False)
        def favicon():
            return FileResponse(frontend / "favicon.svg")

        @app.get("/pcm-capture-worklet.js", include_in_schema=False)
        def capture_worklet():
            return FileResponse(frontend / "pcm-capture-worklet.js", media_type="text/javascript")

        @app.get("/", include_in_schema=False)
        @app.get("/login", include_in_schema=False)
        @app.get("/register", include_in_schema=False)
        def frontend_page():
            return FileResponse(frontend / "index.html")

    return app


app = create_app()
