from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.strip().lower() if isinstance(value, str) else value


class RegisterInput(LoginInput):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-z0-9_]+$")
    # The language chosen on the sign-up page; the account starts with it.
    language: Literal["zh", "en"] = "zh"


class PasswordChangeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class LanguageInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: Literal["zh", "en"]


class UserOutput(BaseModel):
    id: str
    username: str
    display_name: str
    language: Literal["zh", "en"]
    created_at: datetime


class CsrfOutput(BaseModel):
    csrf_token: str


class HealthOutput(BaseModel):
    status: str
    service: str


class ErrorDetail(BaseModel):
    code: str
    message: str
    request_id: str
    details: list[dict[str, str]] | None = None


class ErrorOutput(BaseModel):
    error: ErrorDetail
