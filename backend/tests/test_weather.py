from datetime import UTC, datetime, timedelta

import pytest
from app import weather


def sample(now, temperature=24, description="天晴。"):
    return {
        "rhrread": {
            "updateTime": now.isoformat(),
            "icon": [50],
            "temperature": {"data": [{"place": "香港天文台", "value": temperature}]},
            "humidity": {"data": [{"value": 65}]},
        },
        "flw": {
            "updateTime": now.isoformat(),
            "forecastPeriod": "今日天气预测",
            "forecastDesc": description,
        },
        "warnsum": {},
    }


def normalized(data, now):
    return weather.normalize_weather(data["rhrread"], data["flw"], data["warnsum"], now)


def test_daytime_outdoor_and_hong_kong_date():
    now = datetime(2026, 11, 12, 2, tzinfo=UTC)
    result = normalized(sample(now), now)
    assert result.hong_kong_date == "2026-11-12"
    assert result.temperature == 24
    assert result.observed_at.tzinfo == UTC


def test_active_warnings_are_listed():
    now = datetime(2026, 11, 12, 2, tzinfo=UTC)
    data = sample(now)
    data["warnsum"] = {"WTS": {"name": "雷暴警告", "actionCode": "ISSUE"}}
    assert normalized(data, now).warnings == ["雷暴警告"]


def test_evening_rolls_over_hong_kong_date():
    now = datetime(2026, 11, 12, 17, tzinfo=UTC)
    assert normalized(sample(now), now).hong_kong_date == "2026-11-13"


def test_canceled_warning_is_not_listed():
    now = datetime(2026, 11, 12, 2, tzinfo=UTC)
    data = sample(now)
    data["warnsum"] = {"WTS": {"name": "雷暴警告", "actionCode": "CANCEL"}}
    assert normalized(data, now).warnings == []


def test_expired_data_is_rejected():
    now = datetime.now(UTC)
    data = sample(now - timedelta(hours=3))
    with pytest.raises(ValueError):
        normalized(data, now)


def test_cache_and_outage_fallback(monkeypatch):
    data = sample(datetime.now(UTC))
    calls = []

    def fetch(kind):
        calls.append(kind)
        return data[kind]

    monkeypatch.setattr(weather, "fetch_hko", fetch)
    service = weather.WeatherService()
    assert service.get().status == "live"
    service.get()
    assert len(calls) == 3

    def failed(_):
        raise OSError("offline")

    monkeypatch.setattr(weather, "fetch_hko", failed)
    service._last_attempt -= 301
    stale = service.get()
    assert stale.status == "stale"
    assert stale.temperature == 24
    unavailable = weather.WeatherService().get()
    assert unavailable.status == "unavailable"
    assert unavailable.temperature is None
    assert unavailable.observed_at is None
