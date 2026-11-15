"""HKU guide pages (postgraduates): sections from the verified knowledge files.

Content comes only from backend/app/agent/knowledge/hk/*.md with `topic: hku`; each file is
checked against official HKU pages and lists its sources and check date. Categories without a
verified file yet are returned empty, so the page says so instead of showing placeholders.
"""

import json
from functools import cache
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import services
from app.agent.tools import KNOWLEDGE_DIR, frontmatter
from app.api import database
from app.core.security import SESSION_COOKIE
from app.schemas import ErrorOutput

router = APIRouter(prefix="/api/v1/guides", responses={401: {"model": ErrorOutput}})

CATEGORIES = [
    ("library", "图书馆"),
    ("transport", "交通与校园位置"),
    ("services", "学生服务与联系方式"),
]


class GuideSource(BaseModel):
    label: str
    url: str


class GuideSection(BaseModel):
    heading: str
    # Lines separated by "\n": plain paragraphs, or facts written as "- 标签：内容".
    text: str


class GuideDocument(BaseModel):
    title: str
    verified: str
    # "rows": every section takes a full row; "cards": short sections may sit side by side.
    layout: Literal["cards", "rows"] = "cards"
    sources: list[GuideSource]
    sections: list[GuideSection]


class GuideCategory(BaseModel):
    id: str
    title: str
    documents: list[GuideDocument]


class Guide(BaseModel):
    audience: str = "研究生"
    categories: list[GuideCategory]


class LibrarySpot(BaseModel):
    kind: Literal["study", "service", "tech", "collection"]
    wing: str | None
    name: str
    text: str


class LibraryPrinter(BaseModel):
    number: str
    wing: str
    print_mode: Literal["bw", "colour"]
    copy_mode: Literal["bw", "colour"] | None
    wifi: bool
    scan: bool


class LibraryFloor(BaseModel):
    id: str
    label: str
    wings: list[str]
    spots: list[LibrarySpot]
    printers: list[LibraryPrinter]


class Library(BaseModel):
    name: str
    intro: str
    floors: list[LibraryFloor]


class HkuPlaces(BaseModel):
    """Main Library floors (top floor first) for the 2.5D floor view."""

    verified: str
    sources: list[GuideSource]
    library: Library


@cache
def load_hku_places() -> HkuPlaces:
    path = KNOWLEDGE_DIR / "hku-places.json"
    return HkuPlaces.model_validate(json.loads(path.read_text(encoding="utf-8")))


def load_hku_guide() -> Guide:
    documents: dict[str, list[GuideDocument]] = {key: [] for key, _ in CATEGORIES}
    for path in sorted(KNOWLEDGE_DIR.glob("*.md")):
        fields, sources, body = frontmatter(path.read_text(encoding="utf-8"))
        if fields.get("topic") != "hku" or fields.get("category") not in documents:
            continue
        sections = []
        for block in body.split("\n## ")[1:]:
            heading, _, text = block.partition("\n")
            # Keep one line per paragraph or "- 标签：内容" fact, so the page can lay them out.
            lines = [" ".join(line.split()) for line in text.splitlines() if line.strip()]
            sections.append(GuideSection(heading=heading.strip(), text="\n".join(lines)))
        documents[fields["category"]].append(
            GuideDocument(
                title=fields["title"],
                verified=fields["verified"],
                layout="rows" if fields.get("layout") == "rows" else "cards",
                sources=[GuideSource(label=label, url=url) for label, url in sources],
                sections=sections,
            )
        )
    return Guide(
        categories=[
            GuideCategory(id=key, title=title, documents=documents[key])
            for key, title in CATEGORIES
        ]
    )


@router.get("/hku", response_model=Guide)
def hku_guide(request: Request, db: Session = Depends(database)) -> Guide:
    services.current_user(db, request.cookies.get(SESSION_COOKIE))
    return load_hku_guide()


@router.get("/hku/places", response_model=HkuPlaces)
def hku_places(request: Request, db: Session = Depends(database)) -> HkuPlaces:
    services.current_user(db, request.cookies.get(SESSION_COOKIE))
    return load_hku_places()
