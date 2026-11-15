import json

import httpx
import pytest
from app.agent.places import (
    FIELD_MASK,
    HKU,
    Choices,
    DailyLimit,
    PlaceQuery,
    metres,
    offer_choices,
    search_places,
)
from test_agent_api import ScriptedModel, agent, answer, events, tool_turn, use  # noqa: F401
from test_auth import login, register
from test_calendar import write

GOOGLE = {
    "places": [
        {
            "id": "p1",
            "displayName": {"text": "合成川菜馆", "languageCode": "zh-CN"},
            "shortFormattedAddress": "西营盘第二街 1 号",
            "location": {"latitude": 22.2866, "longitude": 114.1420},
            "rating": 4.4,
            "userRatingCount": 812,
            "priceLevel": "PRICE_LEVEL_MODERATE",
            "currentOpeningHours": {"openNow": True},
            "primaryTypeDisplayName": {"text": "四川菜馆"},
            "googleMapsUri": "https://maps.google.com/?cid=1",
        },
        {
            "id": "p2",
            "displayName": {"text": "合成甜品铺"},
            "location": {"latitude": 22.2831, "longitude": 114.1372},
            "currentOpeningHours": {"openNow": False},
            "googleMapsUri": "https://maps.google.com/?cid=2",
        },
    ]
}


def google(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def context(handler=None, key="AIza-test", limit=None):
    return {
        "user_id": "u1",
        "places_key": key,
        "places_limit": limit or DailyLimit(),
        "places_client": google(handler or (lambda r: httpx.Response(200, json=GOOGLE))),
    }


def test_search_near_hku_uses_field_mask_and_location_bias():
    seen = []

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json=GOOGLE)

    result = search_places(PlaceQuery(what="川菜", open_now=True, budget="cheap"), context(handle))
    request = seen[0]
    assert str(request.url) == "https://places.googleapis.com/v1/places:searchText"
    assert request.headers["X-Goog-Api-Key"] == "AIza-test"
    assert request.headers["X-Goog-FieldMask"] == FIELD_MASK
    assert "reviews" not in FIELD_MASK  # only the fields the card shows
    body = json.loads(request.content)
    assert body["textQuery"] == "川菜" and body["regionCode"] == "HK"
    assert body["locationBias"]["circle"]["center"] == {"latitude": HKU[0], "longitude": HKU[1]}
    assert body["openNow"] is True and body["priceLevels"] == ["PRICE_LEVEL_INEXPENSIVE"]
    assert body["maxResultCount"] == 3

    card = result.card
    assert card["type"] == "places" and card["where"] == "near HKU main campus"
    first, second = card["places"]
    assert first == {
        "name": "合成川菜馆",
        "kind": "四川菜馆",
        "rating": 4.4,
        "rating_count": 812,
        "price": "$$",
        "open_now": True,
        "address": "西营盘第二街 1 号",
        "maps_url": "https://maps.google.com/?cid=1",
        "walk_minutes_from_hku": 9,
    }
    assert second["walk_minutes_from_hku"] == 1 and second["rating"] is None
    # The model gets the facts but not the links (the card shows them).
    assert "maps_url" not in json.dumps(result.for_model)
    assert "Do not list" in result.for_model["note"]


def test_named_area_goes_into_the_query_without_hku_bias():
    seen = []

    def handle(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json=GOOGLE)

    result = search_places(PlaceQuery(what="甜品", area=" 西营盘 ", max_results=1), context(handle))
    assert seen[0]["textQuery"] == "甜品 西营盘"
    assert "locationBias" not in seen[0] and "openNow" not in seen[0]
    assert "priceLevels" not in seen[0]
    assert len(result.card["places"]) == 1
    assert "walk_minutes_from_hku" not in result.card["places"][0]
    assert result.card["where"] == "西营盘"


@pytest.mark.parametrize(
    "response,expected",
    [
        (httpx.Response(403, json={"error": {"status": "PERMISSION_DENIED"}}), "not allowed"),
        (httpx.Response(429, json={}), "quota"),
        (httpx.Response(500, json={}), "failed"),
        (httpx.Response(200, json={"places": []}), "Nothing found"),
    ],
)
def test_google_errors_and_empty_results_are_reported_simply(response, expected):
    result = search_places(PlaceQuery(what="x"), context(lambda r: response))
    text = json.dumps(result.for_model)
    assert expected in text and result.card is None
    assert "AIza" not in text


def test_missing_key_network_errors_and_daily_limits():
    result = search_places(PlaceQuery(what="x"), context(key=""))
    assert "not configured" in result.for_model["error"]

    def down(request):
        raise httpx.ConnectError("down")

    assert (
        "could not be reached"
        in search_places(PlaceQuery(what="x"), context(down)).for_model["error"]
    )
    limit = DailyLimit(per_user=2, total=3)
    assert limit.take("a", "2026-11-14") and limit.take("a", "2026-11-14")
    assert not limit.take("a", "2026-11-14")
    assert limit.take("b", "2026-11-14")
    assert not limit.take("c", "2026-11-14")  # app-wide cap
    assert limit.take("a", "2026-11-15")  # new day
    spent = DailyLimit(per_user=0)
    assert "limit" in search_places(PlaceQuery(what="x"), context(limit=spent)).for_model["error"]


def test_distance_and_query_validation():
    assert metres(HKU, HKU) == 0
    assert 550 <= metres(HKU, (22.2866, 114.1420)) <= 680
    with pytest.raises(ValueError):
        PlaceQuery(what="x", max_results=9)
    with pytest.raises(ValueError):
        PlaceQuery(what="x", user_id="someone")


def test_choices_are_cleaned_and_only_shown_when_useful():
    result = offer_choices(Choices(options=[" 中餐 ", "中餐", "甜品", "你帮我推荐"]), {})
    assert result.card == {"type": "choices", "options": ["中餐", "甜品", "你帮我推荐"]}
    single = offer_choices(Choices(options=["中餐", " 中餐"]), {})
    assert single.card is None
    with pytest.raises(ValueError):
        Choices(options=["a"])


def test_friend_style_flow_asks_first_then_recommends(agent):  # noqa: F811
    agent.app.state.google_maps_key = "AIza-test"
    agent.app.state.places_client = google(lambda r: httpx.Response(200, json=GOOGLE))
    register(agent)
    login(agent)
    use(
        agent,
        ScriptedModel(
            tool_turn(("offer_choices", {"options": ["中餐", "甜品", "你帮我推荐"]})),
            answer("可以啊！想吃点什么？没想法的话我帮你挑。"),
        ),
    )
    kinds = events(
        write(
            agent,
            "POST",
            "/api/v1/agent/chat",
            {"messages": [{"role": "user", "content": "帮我找找西营盘美食"}]},
        )
    )
    # Quick replies are a card, not a visible "step".
    assert [kind for kind, _ in kinds] == ["card", "answer", "done"]
    assert kinds[0][1]["options"] == ["中餐", "甜品", "你帮我推荐"]

    model = use(
        agent,
        ScriptedModel(
            tool_turn(("search_places", {"what": "川菜", "area": "西营盘"})),
            tool_turn(("offer_choices", {"options": ["换个口味", "再便宜点", "就去这家"]})),
            answer("推荐合成川菜馆：4.4 分、正在营业。要不要换个口味？"),
        ),
    )
    turns = [
        {"role": "user", "content": "帮我找找西营盘美食"},
        {"role": "assistant", "content": "可以啊！想吃点什么？"},
        {"role": "user", "content": "中餐，想吃辣的"},
    ]
    kinds = events(write(agent, "POST", "/api/v1/agent/chat", {"messages": turns}))
    assert [kind for kind, _ in kinds] == ["step", "step", "card", "card", "answer", "done"]
    assert kinds[0][1] == {
        "tool": "search_places",
        "label": "正在 Google 地图上找",
        "state": "running",
    }
    assert kinds[2][1]["type"] == "places" and kinds[3][1]["type"] == "choices"
    sent = json.loads(model.seen[1][0][-1].content)
    assert sent["places"][0]["name"] == "合成川菜馆"
