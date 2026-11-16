"""End-to-end check of live lecture captions with the real local models.

Streams a synthetic lecture WAV (or, with --ted N, a real TED talk) into
/api/v1/lecture/stream in real time (100 ms frames)
using an in-process app with a temporary database and test account, then reports caption
latency and word error rate. Needs `uv sync --group speech --group bench`, the Whisper model
in private-data/models and Ollama running. Prints only metrics and caption text from the
synthetic script; results are not saved.
"""

import argparse
import json
import statistics
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import jiwer  # noqa: E402
import soundfile as sf  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ORIGIN = "http://127.0.0.1:5173"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--wav", default=str(ROOT / "private-data/bench/synthetic/lecture_daniel_noisy10db.wav")
    )
    parser.add_argument("--show", type=int, default=4, help="captions to print")
    parser.add_argument("--ted", type=int, help="use TED-LIUM long-form talk N (real speech)")
    parser.add_argument("--seconds", type=float, default=0, help="only stream the first N s")
    args = parser.parse_args()
    if args.ted is not None:
        audio, rate = ted_audio(args.ted)
    else:
        audio, rate = sf.read(args.wav, dtype="int16")
    if args.seconds:
        audio = audio[: int(args.seconds * rate)]
    assert rate == 16000, "expects 16 kHz mono audio"
    with tempfile.TemporaryDirectory() as tmp:
        database = Path(tmp) / "stream.sqlite3"
        import os

        os.environ["HKM_DATABASE_PATH"] = str(database)
        command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
        app = create_app(
            Settings(database_path=database, allowed_origins=(ORIGIN,), auto_mail_enabled=False)
        )
        with TestClient(app) as client:
            headers = {"Origin": ORIGIN}

            def post(path, body):
                token = client.get("/api/v1/auth/csrf").json()["csrf_token"]
                return client.post(path, json=body, headers=headers | {"X-CSRF-Token": token})

            account = {"username": "stream_test", "password": "synthetic-password-123"}
            post("/api/v1/auth/register", account)
            post("/api/v1/auth/login", account)
            run(client, audio.tobytes(), len(audio) / rate, args.show, args.ted is None)


def ted_audio(index: int):
    import io

    import pyarrow.parquet as pq

    path = next((ROOT / "private-data/bench/tedlium-long-form").rglob("*.parquet"))
    row = pq.read_table(path, columns=["audio"]).column("audio")[index].as_py()
    audio, rate = sf.read(io.BytesIO(row["bytes"]), dtype="int16")
    return (audio if audio.ndim == 1 else audio[:, 0]), rate


def run(client: TestClient, pcm: bytes, seconds: float, show: int, score: bool) -> None:
    received, arrival, first_partial = [], {}, {}
    partial_count = 0
    translated = 0  # captions fully translated so far
    with client.websocket_connect("/api/v1/lecture/stream", headers={"Origin": ORIGIN}) as ws:
        load_started = time.monotonic()
        while (message := ws.receive_json()).get("state") != "listening":
            if message["type"] == "error":
                raise SystemExit(message["message"])
        print(f"model ready in {time.monotonic() - load_started:.1f}s")
        stream_started = time.monotonic()

        def sender() -> None:
            frame = 3200  # 100 ms of PCM16
            for index, start in enumerate(range(0, len(pcm), frame)):
                delay = stream_started + index * 0.1 - time.monotonic()
                if delay > 0:
                    time.sleep(delay)
                ws.send_bytes(pcm[start : start + frame])
            ws.send_text(json.dumps({"type": "stop"}))

        thread = threading.Thread(target=sender)
        thread.start()
        while True:
            message = ws.receive_json()
            now = time.monotonic() - stream_started
            if message["type"] == "partial" and message.get("en"):
                first_partial.setdefault(message["offset"], now)
                partial_count += 1
            if message["type"] == "caption":
                arrival.setdefault(message["id"], {})["caption"] = now
                received.append(message)
            if message["type"] == "translation":
                # A translation covers every caption up to "upto" (sentences span captions).
                for cid in range(translated + 1, message["upto"] + 1):
                    arrival.setdefault(cid, {})["translation"] = now
                translated = max(translated, message["upto"])
                received.append(message)
            if message["type"] == "error":
                raise SystemExit(message["message"])
            if message.get("state") == "stopped":
                break
        thread.join()

    captions = {m["id"]: m for m in received if m["type"] == "caption"}
    translations = [m for m in received if m["type"] == "translation"]
    caption_delay, translation_delay, from_start, lengths, first_english = [], [], [], [], []
    for cid, caption in captions.items():
        spoken_end = caption["offset"] + caption["duration"]
        lengths.append(caption["duration"])
        shown = min(arrival[cid]["caption"], first_partial.get(caption["offset"], float("inf")))
        first_english.append(shown - caption["offset"])
        caption_delay.append(arrival[cid]["caption"] - spoken_end)
        if "translation" in arrival[cid]:
            translation_delay.append(arrival[cid]["translation"] - spoken_end)
            # What a listener feels: from the first word of the segment to its Chinese.
            from_start.append(arrival[cid]["translation"] - caption["offset"])

    def stats(values: list[float]) -> str:
        values = sorted(values)
        p90 = values[int(0.9 * (len(values) - 1))]
        return f"median {statistics.median(values):.2f}s, P90 {p90:.2f}s, max {values[-1]:.2f}s"

    failed = sum(1 for t in translations if not t["zh"])
    paragraphs = len({c["paragraph"] for c in captions.values()})
    print(
        f"audio {seconds:.0f}s | captions {len(captions)} | paragraphs {paragraphs} | "
        f"translated units {len(translations)} | failed {failed}"
    )
    print(f"segment length: {stats(lengths)}")
    print(f"sentence end -> English caption: {stats(caption_delay)}")
    print(f"sentence end -> Chinese caption: {stats(translation_delay)}")
    print(f"segment start -> first English (interim or final): {stats(first_english)}")
    print(f"segment start -> Chinese caption: {stats(from_start)}")
    print(f"interim lines: {partial_count}")
    if score:
        from transformers.models.whisper.english_normalizer import BasicTextNormalizer

        norm = BasicTextNormalizer()
        script = (ROOT / "scripts/bench-data/lecture_script.txt").read_text()
        hypothesis = " ".join(captions[i]["en"] for i in sorted(captions))
        print(f"WER vs script (basic normalizer): {jiwer.wer(norm(script), norm(hypothesis)):.3f}")
    for number in sorted({c["paragraph"] for c in captions.values()})[:show]:
        ids = [cid for cid in sorted(captions) if captions[cid]["paragraph"] == number]
        print(f"  [{captions[ids[0]]['offset']:6.1f}s] {' '.join(captions[i]['en'] for i in ids)}")
        print(
            f"            {''.join(t['zh'] or '(failed)' for t in translations if t['id'] in ids)}"
        )


if __name__ == "__main__":
    main()
