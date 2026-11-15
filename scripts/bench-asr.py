"""Phase 1 speech-recognition benchmark for lecture translation (local, offline).

Runs mlx-whisper on public test audio and synthetic lectures, reporting WER, speed and
per-segment latency. Needs `uv sync --group speech --group bench`; audio and results live
in private-data/bench/ (not in Git). Prints only metrics; transcripts go to the results file.
"""

import argparse
import io
import json
import os
import statistics
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / "private-data/models/hf"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")

import jiwer  # noqa: E402
import mlx.core as mx  # noqa: E402
import mlx_whisper  # noqa: E402
import numpy as np  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402
import soundfile as sf  # noqa: E402
from huggingface_hub import snapshot_download  # noqa: E402
from transformers.models.whisper.english_normalizer import EnglishTextNormalizer  # noqa: E402

BENCH = ROOT / "private-data/bench"
MODEL = "mlx-community/whisper-large-v3-turbo"
SR = 16000
TERMS = (
    "DASC7606, Moodle, backpropagation, stochastic gradient descent, mini batch, Adam, "
    "cross entropy, softmax, overfitting, dropout, batch normalization, layer normalization, "
    "transformers, attention, queries and keys."
)


def normalizer() -> EnglishTextNormalizer:
    path = Path(
        snapshot_download("openai/whisper-large-v3-turbo", allow_patterns=["normalizer.json"])
    )
    return EnglishTextNormalizer(json.loads((path / "normalizer.json").read_text()))


def load_sets(names: list[str]) -> list[dict]:
    items = []
    if "synthetic" in names:
        script = (ROOT / "scripts/bench-data/lecture_script.txt").read_text()
        for wav in sorted((BENCH / "synthetic").glob("lecture_*.wav")):
            audio, sr = sf.read(wav, dtype="float32")
            assert sr == SR
            items.append({"set": "synthetic", "id": wav.stem, "audio": audio, "ref": script})
    if "librispeech" in names:
        table = pq.read_table(next((BENCH / "librispeech_asr_dummy").rglob("*.parquet")))
        rows = table.to_pylist()
        audio = [sf.read(io.BytesIO(r["audio"]["bytes"]), dtype="float32")[0] for r in rows]
        refs = [r["text"] for r in rows]
        items.append({"set": "librispeech", "id": "73-utterances", "audio": audio, "ref": refs})
    if "tedlium" in names:
        table = pq.read_table(next((BENCH / "tedlium-long-form").rglob("*.parquet")))
        for index, row in enumerate(table.to_pylist()):
            audio = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")[0]
            items.append(
                {"set": "tedlium", "id": f"talk-{index}", "audio": audio, "ref": row["text"]}
            )
    return items


def energy_segments(audio: np.ndarray, min_silence=0.4, max_len=15.0, min_len=1.0) -> list[tuple]:
    """Split at pauses like a live VAD would: (start, end) sample ranges."""
    frame = int(0.03 * SR)
    frames = len(audio) // frame
    rms = np.sqrt((audio[: frames * frame].reshape(frames, frame) ** 2).mean(axis=1) + 1e-12)
    threshold = max(np.percentile(rms, 15) * 2.0, 1e-3)
    silent = rms < threshold
    segments, start, quiet = [], 0, 0
    for i, is_silent in enumerate(silent):
        quiet = quiet + 1 if is_silent else 0
        length = (i - start) * 0.03
        if (quiet * 0.03 >= min_silence and length >= min_len) or length >= max_len:
            end = i - quiet // 2 if quiet else i
            segments.append((start * frame, end * frame))
            start, quiet = end, 0
    if frames - start > int(min_len / 0.03):
        segments.append((start * frame, len(audio)))
    return segments


def transcribe(audio: np.ndarray, prompt: str | None = None) -> str:
    # condition_on_previous_text=True made long-form output loop (36 inserted words on one
    # synthetic lecture); live segments get bounded context through `prompt` instead.
    result = mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=MODEL,
        language="en",
        initial_prompt=prompt,
        verbose=None,
        condition_on_previous_text=False,
    )
    return result["text"].strip()


def wer(norm, refs, hyps) -> float:
    pairs = [(norm(r), norm(h)) for r, h in zip(refs, hyps)]
    pairs = [(r, h) for r, h in pairs if r]
    return jiwer.wer([r for r, _ in pairs], [h for _, h in pairs])


def peak_gb() -> float:
    getter = getattr(mx, "get_peak_memory", None) or mx.metal.get_peak_memory
    return round(getter() / 1e9, 2)


def run(item: dict, norm, mode: str, prompt: str | None, chunk_seconds: float | None) -> dict:
    audios = item["audio"] if isinstance(item["audio"], list) else [item["audio"]]
    refs = item["ref"] if isinstance(item["ref"], list) else [item["ref"]]
    total_audio = sum(len(a) for a in audios) / SR
    latencies, hyps = [], []
    started = time.perf_counter()
    for audio in audios:
        if chunk_seconds:
            audio = audio[: int(chunk_seconds * SR)]
        if mode == "long":
            hyps.append(transcribe(audio, prompt))
            continue
        pieces, context = [], prompt or ""
        for start, end in energy_segments(audio):
            t = time.perf_counter()
            text = transcribe(audio[start:end], (context[-200:] or None))
            latencies.append(time.perf_counter() - t)
            pieces.append(text)
            context = f"{prompt or ''} {text}".strip()
        hyps.append(" ".join(pieces))
    if chunk_seconds and item["set"] == "tedlium":
        # Reference covers the full talk; score only on the transcribed prefix length.
        words = norm(refs[0]).split()
        share = min(1.0, chunk_seconds * SR / len(item["audio"]))
        refs = [" ".join(words[: int(len(words) * share)])]
        total_audio = min(total_audio, chunk_seconds)
    elapsed = time.perf_counter() - started
    return {
        "set": item["set"],
        "id": item["id"],
        "mode": mode,
        "prompt": bool(prompt),
        "audio_seconds": round(total_audio, 1),
        "wer": round(wer(norm, refs, hyps), 4),
        "rtf": round(elapsed / total_audio, 4),
        "segments": len(latencies),
        "latency_median": round(statistics.median(latencies), 3) if latencies else None,
        "latency_p90": round(sorted(latencies)[int(0.9 * (len(latencies) - 1))], 3)
        if latencies
        else None,
        "peak_gb": peak_gb(),
        "hypothesis_preview": hyps[0][:300],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sets", default="synthetic,librispeech,tedlium")
    parser.add_argument("--ted-live-seconds", type=float, default=300)
    args = parser.parse_args()
    norm = normalizer()
    items = load_sets(args.sets.split(","))
    transcribe(np.zeros(SR, dtype=np.float32))  # load weights once before timing
    results = []
    for item in items:
        plans = [("long", None, None), ("live", None, None)]
        if item["set"] == "synthetic":
            plans += [("long", TERMS, None), ("live", TERMS, None)]
        if item["set"] == "librispeech":
            plans = [("long", None, None)]  # already one sentence per utterance
        if item["set"] == "tedlium":
            plans = [("long", None, None), ("live", None, args.ted_live_seconds)]
        for mode, prompt, chunk in plans:
            result = run(item, norm, mode, prompt, chunk)
            results.append(result)
            print(
                f"{result['set']:<11} {result['id']:<24} {mode:<4} prompt={int(bool(prompt))} "
                f"audio={result['audio_seconds']:>6}s WER={result['wer']:.3f} "
                f"RTF={result['rtf']:.3f} seg={result['segments']} "
                f"lat_med={result['latency_median']} p90={result['latency_p90']} "
                f"peak={result['peak_gb']}GB",
                flush=True,
            )
    out = BENCH / "results"
    out.mkdir(exist_ok=True)
    path = out / f"asr-{time.strftime('%Y%m%d-%H%M%S')}.json"
    path.write_text(json.dumps({"model": MODEL, "results": results}, ensure_ascii=False, indent=2))
    os.chmod(path, 0o600)
    print("saved", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
