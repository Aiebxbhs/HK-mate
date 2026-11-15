"""Public HKO weather for the assistant's weather tool, cached locally; no user data is sent
upstream."""

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

HKO_SOURCE = "https://www.hko.gov.hk/sc/index.html"
HK = ZoneInfo("Asia/Hong_Kong")


class TodayWeather(BaseModel):
    status: Literal["live", "stale", "unavailable"]
    hong_kong_date: str
    temperature: float | None = None
    humidity: float | None = None
    station: str = "香港天文台"
    observed_at: datetime | None = None
    fetched_at: datetime
    forecast_period: str = ""
    forecast: str = ""
    warnings: list[str] = Field(default_factory=list)
    source_url: str = HKO_SOURCE


def fetch_hko(kind: str) -> dict:
    url = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?" + urlencode(
        {"dataType": kind, "lang": "sc"}
    )
    with urlopen(url, timeout=6) as response:
        body = response.read(512_001)
    if len(body) > 512_000:
        raise ValueError("Weather response too large")
    data = json.loads(body)
    if not isinstance(data, dict):
        raise ValueError("Invalid weather response")
    return data


def normalize_weather(current: dict, forecast: dict, warnings: dict, now: datetime) -> TodayWeather:
    observed = datetime.fromisoformat(current["updateTime"])
    issued = datetime.fromisoformat(forecast["updateTime"])
    if observed.tzinfo is None or issued.tzinfo is None:
        raise ValueError("Missing weather timezone")
    if not -600 <= (now - observed).total_seconds() <= 7200:
        raise ValueError("Current weather is out of date")
    if not -600 <= (now - issued).total_seconds() <= 86400:
        raise ValueError("Forecast is out of date")
    station = next(row for row in current["temperature"]["data"] if row["place"] == "香港天文台")
    temperature = float(station["value"])
    humidity_rows = current.get("humidity", {}).get("data", [])
    humidity = float(humidity_rows[0]["value"]) if humidity_rows else None
    if not -20 <= temperature <= 60 or (humidity is not None and not 0 <= humidity <= 100):
        raise ValueError("Invalid weather measurements")
    if any(not isinstance(item, dict) or not item.get("name") for item in warnings.values()):
        raise ValueError("Invalid warning summary")
    active_warnings = [
        str(item["name"])
        for item in warnings.values()
        if isinstance(item, dict) and item.get("actionCode") != "CANCEL" and item.get("name")
    ]
    description = forecast["forecastDesc"]
    if not isinstance(description, str) or not description.strip():
        raise ValueError("Missing forecast")
    hk_now = now.astimezone(HK)
    return TodayWeather(
        status="live",
        hong_kong_date=hk_now.date().isoformat(),
        temperature=temperature,
        humidity=humidity,
        observed_at=observed.astimezone(UTC),
        fetched_at=now,
        forecast_period=str(forecast.get("forecastPeriod", "本港地区天气预报")),
        forecast=description,
        warnings=active_warnings,
    )


class WeatherService:
    def __init__(self):
        self._lock = threading.Lock()
        self._last_attempt = 0.0
        self._cached: TodayWeather | None = None
        self._last_good: TodayWeather | None = None

    def get(self) -> TodayWeather:
        with self._lock:
            now = datetime.now(UTC)
            ttl = 300 if self._cached and self._cached.status == "live" else 60
            if self._cached and time.monotonic() - self._last_attempt < ttl:
                return self._cached.model_copy(
                    update={"hong_kong_date": now.astimezone(HK).date().isoformat()}
                )
            self._last_attempt = time.monotonic()
            try:
                with ThreadPoolExecutor(max_workers=3) as pool:
                    payloads = list(pool.map(fetch_hko, ["rhrread", "flw", "warnsum"]))
                result = normalize_weather(*payloads, now)
                self._last_good = result
            except (OSError, ValueError, KeyError, TypeError, StopIteration):
                if self._last_good and (now - self._last_good.fetched_at).total_seconds() < 1800:
                    result = self._last_good.model_copy(
                        update={
                            "status": "stale",
                            "hong_kong_date": now.astimezone(HK).date().isoformat(),
                        }
                    )
                else:
                    result = TodayWeather(
                        status="unavailable",
                        hong_kong_date=now.astimezone(HK).date().isoformat(),
                        fetched_at=now,
                    )
            self._cached = result
            return result
