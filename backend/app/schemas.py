from datetime import datetime

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


class PasswordChangeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class UserOutput(BaseModel):
    id: str
    username: str
    display_name: str
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
