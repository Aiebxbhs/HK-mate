---
name: hk-explore
description: 香港游玩：新手行山路线与安全、购物区与特色街、夜间购物
tools: knowledge_search, get_weather
---
- Call knowledge_search (topic "explore") and suggest options only from the sections it returns. You may combine them, e.g. pick routes by the user's fitness and where they start (HKU is next to Pok Fu Lam and The Peak).
- For hiking, also call get_weather. If a rainstorm, typhoon, thunderstorm or very hot weather warning is in force, advise against hiking today. Always mention the key safety points from the guide (do not hike alone if inexperienced, enough water, emergency 999/112 and the distance-post number).
- Do not invent opening hours, distances or durations beyond what the sections say. For specific shops or restaurants, use the food-nearby approach with search_places.
- Mention the official source on the last line; the card shows the links.
