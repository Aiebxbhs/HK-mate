"""Phase 1 translation benchmark (English lecture sentences -> Simplified Chinese).

Compares small local MT models (CTranslate2 on CPU and Apple GPU) with the local Qwen model
as a quality reference, one sentence at a time as live captions would. Needs
`uv sync --group speech`; results go to private-data/bench/results/ (not in Git).
"""

import argparse
import json
import os
import statistics
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / "private-data/models/hf"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")

import ctranslate2  # noqa: E402
import httpx  # noqa: E402
import sacrebleu  # noqa: E402
from transformers import AutoTokenizer  # noqa: E402

CT2 = ROOT / "private-data/models/ct2"
QWEN = "qwen3:4b-instruct-2507-q4_K_M"
# Terms the references keep untranslated; a good lecture translator should keep them too.
TERMS = ["Moodle", "Adam", "softmax", "dropout", "Transformer", "ReLU", "sigmoid", "CB308", "A4"]


def load_sentences() -> list[dict]:
    lines = (ROOT / "scripts/bench-data/mt_en_zh.jsonl").read_text().splitlines()
    return [json.loads(line) for line in lines if line.strip()]


class Marian:
    def __init__(self, device: str):
        path = CT2 / "opus-mt-en-zh-int8"
        self.tok = AutoTokenizer.from_pretrained(path)
        self.model = ctranslate2.Translator(str(path), device=device, intra_threads=4)

    def __call__(self, text: str) -> str:
        tokens = self.tok.convert_ids_to_tokens(self.tok.encode(text))
        out = self.model.translate_batch([tokens], beam_size=4, max_decoding_length=256)
        ids = self.tok.convert_tokens_to_ids(out[0].hypotheses[0])
        return self.tok.decode(ids, skip_special_tokens=True)


class Nllb:
    def __init__(self, device: str):
        path = CT2 / "nllb-200-distilled-600M-int8"
        self.tok = AutoTokenizer.from_pretrained(path, src_lang="eng_Latn")
        self.model = ctranslate2.Translator(str(path), device=device, intra_threads=4)

    def __call__(self, text: str) -> str:
        tokens = self.tok.convert_ids_to_tokens(self.tok.encode(text))
        out = self.model.translate_batch(
            [tokens], target_prefix=[["zho_Hans"]], beam_size=4, max_decoding_length=256
        )
        ids = self.tok.convert_tokens_to_ids(out[0].hypotheses[0][1:])
        return self.tok.decode(ids, skip_special_tokens=True)


class Qwen:
    PROMPT = (
        "Translate the English lecture sentence into natural Simplified Chinese. Keep course "
        "names, product names, room numbers and technical terms usually written in English "
        "(for example Moodle, Adam, softmax, dropout, Transformer, ReLU) unchanged. "
        "Output only the translation."
    )

    def __init__(self, _device: str):
        self.client = httpx.Client(trust_env=False, timeout=120)

    def __call__(self, text: str) -> str:
        response = self.client.post(
            "http://127.0.0.1:11434/api/chat",
            json={
                "model": QWEN,
                "stream": False,
                "messages": [
                    {"role": "system", "content": self.PROMPT},
                    {"role": "user", "content": text},
                ],
                "options": {"temperature": 0, "num_ctx": 16384, "num_predict": 200},
                "keep_alive": "10m",
            },
        )
        response.raise_for_status()
        return response.json()["message"]["content"].strip()


SYSTEMS = {
    "opus-cpu": (Marian, "cpu"),
    "opus-mps": (Marian, "mps"),
    "nllb-cpu": (Nllb, "cpu"),
    "nllb-mps": (Nllb, "mps"),
    "qwen3-4b": (Qwen, "ollama"),
}


def term_retention(sentences: list[dict], hyps: list[str]) -> tuple[int, int]:
    kept = total = 0
    for item, hyp in zip(sentences, hyps):
        for term in TERMS:
            if term.lower() in item["zh"].lower():
                total += 1
                kept += term.lower() in hyp.lower()
    return kept, total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--systems", default=",".join(SYSTEMS))
    parser.add_argument("--extra", type=Path, help="JSON list of outputs from another system")
    parser.add_argument("--extra-name", default="chrome-translator")
    args = parser.parse_args()
    sentences = load_sentences()
    refs = [[item["zh"] for item in sentences]]
    report = []

    def score(name: str, hyps: list[str], latencies: list[float]) -> None:
        kept, total = term_retention(sentences, hyps)
        row = {
            "system": name,
            "chrF": round(sacrebleu.corpus_chrf(hyps, refs).score, 1),
            "BLEU_zh": round(sacrebleu.corpus_bleu(hyps, refs, tokenize="zh").score, 1),
            "terms_kept": f"{kept}/{total}",
            "latency_median_ms": round(statistics.median(latencies) * 1000) if latencies else None,
            "latency_p90_ms": round(sorted(latencies)[int(0.9 * (len(latencies) - 1))] * 1000)
            if latencies
            else None,
            "outputs": hyps,
        }
        report.append(row)
        print(
            f"{name:<18} chrF={row['chrF']:>5} BLEU={row['BLEU_zh']:>5} "
            f"terms={row['terms_kept']:>5} "
            f"lat_med={row['latency_median_ms']}ms p90={row['latency_p90_ms']}ms",
            flush=True,
        )

    for name in args.systems.split(","):
        cls, device = SYSTEMS[name]
        try:
            system = cls(device)
            system(sentences[0]["en"])  # warm up before timing
        except Exception as exc:  # noqa: BLE001 - report and continue with other systems
            print(f"{name:<18} unavailable: {type(exc).__name__}: {str(exc)[:120]}")
            continue
        hyps, latencies = [], []
        for item in sentences:
            started = time.perf_counter()
            hyps.append(system(item["en"]))
            latencies.append(time.perf_counter() - started)
        score(name, hyps, latencies)
    if args.extra:
        extra = json.loads(args.extra.read_text())
        score(args.extra_name, extra["outputs"], extra.get("latencies", []))

    out = ROOT / "private-data/bench/results"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"mt-{time.strftime('%Y%m%d-%H%M%S')}.json"
    path.write_text(
        json.dumps({"sentences": sentences, "results": report}, ensure_ascii=False, indent=2)
    )
    os.chmod(path, 0o600)
    print("saved", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
