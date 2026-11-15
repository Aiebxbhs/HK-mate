"""Real-model test of the after-class lecture summary (local Ollama + Qwen only).

Sources:
  synthetic  scripts/bench-data/lecture_script.txt (self-written ML lecture, ~2.5 minutes)
  ted        TED-LIUM long-form reference transcripts in private-data/bench (needs the bench
             group); --talks N joins the first N talks into one long "lecture" to measure
             multi-part speed and timing for a 90-minute class.

Times are simulated from word counts (about 2.5 words per second). The result JSON is written
to private-data/bench/results/ (not in Git).
"""

import argparse
import json
import re
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.lecture_summary import LectureSummarizer, Line, Note, SummaryError  # noqa: E402

WORDS_PER_SECOND = 2.5
RESULTS = ROOT / "private-data" / "bench" / "results"


def timed(sentences: list[str]) -> list[Line]:
    lines, clock = [], 0.0
    for sentence in sentences:
        lines.append(Line(round(clock, 2), sentence))
        clock += len(sentence.split()) / WORDS_PER_SECOND + 0.4
    return lines


def synthetic() -> list[Line]:
    text = (ROOT / "scripts" / "bench-data" / "lecture_script.txt").read_text()
    return timed([s for s in re.split(r"(?<=[.?!])\s+", text) if s.strip()])


def ted(talks: int) -> list[Line]:
    import pyarrow.parquet as pq

    path = next((ROOT / "private-data" / "bench" / "tedlium-long-form").rglob("*.parquet"))
    texts = pq.read_table(path, columns=["text"]).column("text").to_pylist()[:talks]
    words = " ".join(texts).split()
    # No punctuation in the references: cut into ~14-word pseudo sentences.
    return timed([" ".join(words[i : i + 14]) for i in range(0, len(words), 14)])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["synthetic", "ted"], default="synthetic")
    parser.add_argument("--talks", type=int, default=1)
    args = parser.parse_args()

    lines = synthetic() if args.source == "synthetic" else ted(args.talks)
    words = sum(len(line.text.split()) for line in lines)
    notes = [Note(60, "作业二什么时候交？", True), Note(120, "Adam vs SGD", False)]
    print(f"{args.source}: {len(lines)} lines, {words} words, ~{lines[-1].at_seconds / 60:.0f} min")
    started = time.monotonic()
    try:
        result = LectureSummarizer(threading.Lock()).summarize(lines, notes)
    except SummaryError as exc:
        print(f"FAILED: {exc} after {time.monotonic() - started:.1f}s")
        sys.exit(1)
    print(f"{result['part_count']} parts, {result['elapsed_seconds']}s\n")
    print("概览：", result["overview"], "\n")
    for point in result["key_points"]:
        print(f"[{point['at_seconds'] / 60:5.1f} min] {point['text']}")
        for quote in point["quotes"]:
            print(f"      > {quote['en'][:110]}")
    for reminder in result["reminders"]:
        print(f"提醒 {reminder['kind']} [{reminder['at_seconds'] / 60:.1f} min] {reminder['text']}")
        for quote in reminder["quotes"]:
            print(f"      > {quote['en'][:110]}")
    RESULTS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = RESULTS / f"lecture-summary-{args.source}-{stamp}.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"\nSaved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
