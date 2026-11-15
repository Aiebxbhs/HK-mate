"""Nearby places from Google Places API (New) Text Search, plus quick-reply choices.

Only the fields the cards show are requested (field mask), results are never stored
(Google Maps Platform terms), and the cards credit Google Maps and link to each place on
Google Maps. Searches are capped per account and per app each day to bound the cost.
"""

import math
import threading
import time
from collections import defaultdict
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field

from app.agent.runtime import Tool, ToolResult

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ",".join(
    f"places.{name}"
    for name in (
        "id",
        "displayName",
        "shortFormattedAddress",
        "location",
        "rating",
        "userRatingCount",
        "priceLevel",
        "currentOpeningHours.openNow",
        "primaryTypeDisplayName",
        "googleMapsUri",
    )
)
HKU = (22.2830, 114.1371)  # HKU main campus, Pok Fu Lam Road
WALK_METRES_PER_MINUTE = 75
PRICE = {
    "PRICE_LEVEL_FREE": "免费",
    "PRICE_LEVEL_INEXPENSIVE": "$",
    "PRICE_LEVEL_MODERATE": "$$",
    "PRICE_LEVEL_EXPENSIVE": "$$$",
    "PRICE_LEVEL_VERY_EXPENSIVE": "$$$$",
}
BUDGET_LEVELS = {
    "cheap": ["PRICE_LEVEL_INEXPENSIVE"],
    "moderate": ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"],
    "any": [],
}
GOOGLE_ERRORS = {
    400: "The search request was rejected; try simpler words.",
    403: "Place search is not allowed with the current Google key (check the key, its API "
    "restrictions and billing).",
    429: "Google's daily place-search quota is used up.",
}


class DailyLimit:
    """Searches per account and for the whole app in the current Hong Kong day."""

    def __init__(self, per_user: int = 30, total: int = 300):
        self.per_user, self.total = per_user, total
        self.lock = threading.Lock()
        self.day = ""
        self.counts: dict[str, int] = defaultdict(int)

    def take(self, user_id: str, today: str | None = None) -> bool:
        today = today or time.strftime("%Y-%m-%d", time.gmtime(time.time() + 8 * 3600))
        with self.lock:
            if today != self.day:
                self.day, self.counts = today, defaultdict(int)
            if self.counts[user_id] >= self.per_user or sum(self.counts.values()) >= self.total:
                return False
            self.counts[user_id] += 1
            return True


def metres(a: tuple[float, float], b: tuple[float, float]) -> int:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return round(6371000 * 2 * math.asin(math.sqrt(h)))


class PlaceQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    what: str = Field(
        min_length=1,
        max_length=80,
        description="What to look for, e.g. '川菜', '茶餐厅', 'coffee', '甜品', 'ramen'.",
    )
    area: str = Field(
        default="",
        max_length=60,
        description="Neighbourhood or landmark, e.g. '西营盘', '中环', '坚尼地城'. Empty = "
        "near HKU main campus.",
    )
    open_now: bool = Field(default=False, description="Only places open right now.")
    budget: Literal["cheap", "moderate", "any"] = "any"
    max_results: int = Field(default=3, ge=1, le=5)


def place_item(place: dict, near_hku: bool) -> dict:
    location = place.get("location") or {}
    item = {
        "name": (place.get("displayName") or {}).get("text", ""),
        "kind": (place.get("primaryTypeDisplayName") or {}).get("text", ""),
        "rating": place.get("rating"),
        "rating_count": place.get("userRatingCount"),
        "price": PRICE.get(place.get("priceLevel", ""), ""),
        "open_now": (place.get("currentOpeningHours") or {}).get("openNow"),
        "address": place.get("shortFormattedAddress", ""),
        "maps_url": place.get("googleMapsUri", ""),
    }
    if near_hku and "latitude" in location:
        distance = metres(HKU, (location["latitude"], location["longitude"]))
        item["walk_minutes_from_hku"] = max(1, round(distance / WALK_METRES_PER_MINUTE))
    return item


def search_places(arguments: PlaceQuery, context: dict) -> ToolResult:
    key = context.get("places_key", "")
    if not key:
        return ToolResult({"error": "Place search is not configured on this computer."})
    if not context["places_limit"].take(context["user_id"]):
        return ToolResult({"error": "Today's place-search limit is reached; try tomorrow."})
    area = " ".join(arguments.area.split())
    near_hku = not area or any(word in area.lower() for word in ("港大", "hku", "香港大学"))
    body: dict = {
        "textQuery": f"{arguments.what} {area}".strip() if not near_hku else arguments.what,
        "languageCode": "zh-CN",
        "regionCode": "HK",
        "maxResultCount": arguments.max_results,
    }
    if near_hku:
        body["locationBias"] = {
            "circle": {"center": {"latitude": HKU[0], "longitude": HKU[1]}, "radius": 1200.0}
        }
    if arguments.open_now:
        body["openNow"] = True
    if BUDGET_LEVELS[arguments.budget]:
        body["priceLevels"] = BUDGET_LEVELS[arguments.budget]
    headers = {"X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK}
    try:
        client = context.get("places_client")
        if client is None:
            with httpx.Client(timeout=15, trust_env=True, follow_redirects=False) as session:
                response = session.post(SEARCH_URL, json=body, headers=headers)
        else:
            response = client.post(SEARCH_URL, json=body, headers=headers)
    except httpx.HTTPError:
        return ToolResult({"error": "Google place search could not be reached."})
    if response.status_code != 200:
        return ToolResult(
            {"error": GOOGLE_ERRORS.get(response.status_code, "Google place search failed.")}
        )
    try:
        places = response.json().get("places") or []
    except ValueError:
        return ToolResult({"error": "Google place search returned an unreadable answer."})
    items = [place_item(place, near_hku) for place in places[: arguments.max_results]]
    items = [item for item in items if item["name"]]
    where = "near HKU main campus" if near_hku else area
    if not items:
        return ToolResult(
            {
                "places": [],
                "note": f"Nothing found for {arguments.what!r} {where}. Suggest widening the "
                "area, dropping filters or another kind of food.",
            }
        )
    return ToolResult(
        {
            "where": where,
            "places": [{k: v for k, v in item.items() if k != "maps_url"} for item in items],
            "note": "The user sees these in a card with Google Maps links. Do not list "
            "addresses; pick what fits and say why in a few words.",
        },
        card={"type": "places", "where": where, "query": arguments.what, "places": items},
    )


class Choices(BaseModel):
    model_config = ConfigDict(extra="forbid")
    options: list[str] = Field(
        min_length=2,
        max_length=5,
        description="2-5 short replies the user can tap, written as the user would say them, "
        "e.g. ['中餐', '甜品', '咖啡', '你帮我推荐'].",
    )


def offer_choices(arguments: Choices, context: dict) -> ToolResult:
    options = [" ".join(option.split())[:20] for option in arguments.options]
    options = list(dict.fromkeys(option for option in options if option))
    return ToolResult(
        {"status": "buttons_shown", "note": "Ask your question in the reply text as well."},
        card={"type": "choices", "options": options} if len(options) >= 2 else None,
    )


PLACE_TOOLS = [
    Tool(
        "search_places",
        "Search Google Maps for restaurants, cafes, dessert shops and other places near HKU "
        "or in a named Hong Kong area. Use only once you know roughly what the user wants.",
        PlaceQuery,
        search_places,
    ),
    Tool(
        "offer_choices",
        "Show 2-5 tappable quick replies under your message, to guide the user step by step "
        "(e.g. what to eat, budget, next step).",
        Choices,
        offer_choices,
    ),
]
