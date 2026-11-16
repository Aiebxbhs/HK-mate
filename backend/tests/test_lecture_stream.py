import json
import threading

import httpx
import numpy as np
import pytest
from app.lecture_stream import (
    HALLUCINATIONS,
    SAMPLE_RATE,
    LiveLectures,
    QwenTranslator,
    RecognizerUnavailable,
    Segmenter,
    WhisperRecognizer,
)
from app.mail_summary import NUM_CTX
from starlette.websockets import WebSocketDisconnect
from test_auth import login, register

ORIGIN = {"Origin": "http://testserver"}
rng = np.random.default_rng(3)


def pcm(*parts: tuple[str, float]) -> bytes:
    """("speech" | "silence", seconds) -> PCM16 bytes."""
    chunks = []
    for kind, seconds in parts:
        n = int(seconds * SAMPLE_RATE)
        level = 0.2 if kind == "speech" else 0.001
        chunks.append(rng.standard_normal(n) * level)
    audio = np.clip(np.concatenate(chunks), -1, 1)
    return (audio * 32767).astype("<i2").tobytes()


def feed(segmenter: Segmenter, data: bytes, step: int = 3200) -> list:
    out = []
    for start in range(0, len(data), step):
        out += segmenter.feed(data[start : start + step])
    return out


def test_segmenter_splits_on_pauses_and_caps_long_speech():
    segments = feed(
        Segmenter(),
        pcm(("silence", 1.0), ("speech", 2.0), ("silence", 1.0), ("speech", 1.5), ("silence", 1.0)),
    )
    assert len(segments) == 2
    assert segments[0].offset == pytest.approx(0.8, abs=0.1)  # 0.2 s pre-roll
    assert segments[1].offset == pytest.approx(3.8, abs=0.1)
    assert 2.0 <= len(segments[0].audio) / SAMPLE_RATE <= 2.9

    long = feed(Segmenter(), pcm(("silence", 0.5), ("speech", 30.0), ("silence", 1.0)))
    # Unbroken speech is cut at most every 7 s and nothing is lost: 30 s of speech plus the
    # 0.2 s pre-roll and the short closing pause.
    lengths = [len(s.audio) / SAMPLE_RATE for s in long]
    assert len(lengths) == 5 and max(lengths) <= 7.0 and min(lengths[:-1]) >= 5.0
    # A last piece under 3 s closes after the 0.5 s pause, which is included.
    assert sum(lengths) == pytest.approx(30.2 + 0.5, abs=0.1)
    assert long[1].offset == pytest.approx(long[0].offset + lengths[0], abs=0.01)


def test_segmenter_ignores_clicks_and_flushes_the_tail():
    assert feed(Segmenter(), pcm(("silence", 1.0), ("speech", 0.09), ("silence", 1.0))) == []
    segmenter = Segmenter()
    assert feed(segmenter, pcm(("silence", 1.0), ("speech", 1.5))) == []
    tail = segmenter.flush()
    assert tail is not None and tail.offset == pytest.approx(0.8, abs=0.1)
    assert segmenter.flush() is None


def test_short_pauses_close_long_sentences():
    # 0.3 s gaps (typical between lecture sentences) split once a segment passes 3 s.
    data = pcm(
        ("silence", 1.0),
        ("speech", 6.0),
        ("silence", 0.3),
        ("speech", 2.0),
        ("silence", 0.3),
        ("speech", 2.0),
        ("silence", 1.0),
    )
    segments = feed(Segmenter(), data)
    assert len(segments) == 2
    assert segments[1].offset == pytest.approx(7.3, abs=0.15)
    assert len(segments[0].audio) / SAMPLE_RATE < 6.6


def test_odd_byte_chunks_are_reassembled_without_losing_samples():
    segmenter = Segmenter()
    data = pcm(("silence", 1.0), ("speech", 1.0), ("silence", 1.0))
    assert len(feed(segmenter, data, step=4000)) == 1
    assert segmenter.seconds == pytest.approx(3.0, abs=0.04)


class FakeRecognizer:
    def __init__(self, error: str | None = None):
        self.error, self.calls = error, []

    def load(self):
        if self.error:
            raise RecognizerUnavailable(self.error)

    def transcribe(self, audio, prompt):
        # Named by length, so interim and final recognitions are easy to tell apart.
        self.calls.append((round(len(audio) / SAMPLE_RATE, 1), prompt))
        return f"{len(audio) / SAMPLE_RATE:.1f}s of speech"


class FakeTranslator:
    def __init__(self):
        self.calls = []

    def translate(self, sentence, previous):
        self.calls.append((sentence, list(previous)))
        return f"译文：{sentence}"


@pytest.fixture
def live(client):
    client.app.state.lecture_recognizer = FakeRecognizer()
    client.app.state.lecture_translator = FakeTranslator()
    return client


def receive_until(ws, kind, state=None):
    messages = []
    while True:
        message = ws.receive_json()
        messages.append(message)
        if message["type"] == kind and (state is None or message.get("state") == state):
            return messages


def test_stream_captions_translates_and_keeps_context(live):
    register(live)
    login(live)
    with live.websocket_connect("/api/v1/lecture/stream", headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "status", "state": "loading"}
        assert ws.receive_json() == {"type": "status", "state": "listening"}
        assert live.app.state.live_lectures.active()
        audio = pcm(("silence", 1.0), ("speech", 2.0), ("silence", 1.0), ("speech", 1.0))
        for start in range(0, len(audio), 3200):
            ws.send_bytes(audio[start : start + 3200])
        ws.send_text(json.dumps({"type": "stop"}))
        messages = receive_until(ws, "status", "stopped")
    captions = [m for m in messages if m["type"] == "caption"]
    translations = [m for m in messages if m["type"] == "translation"]
    first, second = (c["en"] for c in captions)
    assert [c["id"] for c in captions] == [1, 2]
    assert first.startswith("2.") and second.startswith("1.")
    assert captions[0]["offset"] == pytest.approx(0.8, abs=0.1)
    assert [c["paragraph"] for c in captions] == [1, 1]
    # Neither piece ends a sentence, so they are translated together once recording stops.
    assert [(t["id"], t["upto"], t["zh"]) for t in translations] == [
        (2, 2, f"译文：{first} {second}")
    ]
    # The second piece gets the first as recognition prompt.
    finals = [call for call in live.app.state.lecture_recognizer.calls if call[1] != first]
    assert (round(float(second[:3]), 1), first) in live.app.state.lecture_recognizer.calls
    assert finals[0][1] is None
    assert live.app.state.lecture_translator.calls == [(f"{first} {second}", [])]
    # Interim lines only ever come before the final caption of their sentence.
    for index, message in enumerate(messages):
        if message["type"] == "partial" and message["en"]:
            later = [m for m in messages[index:] if m["type"] == "caption"]
            assert later, "an interim line must be followed by its final caption"
    assert not live.app.state.live_lectures.active()


class FakeSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, message):
        self.sent.append(message)


def test_interim_lines_are_sent_while_speaking_and_dropped_once_the_sentence_ends():
    import asyncio

    from app.lecture_stream import CaptionPipeline

    async def scenario():
        socket = FakeSocket()
        pipeline = CaptionPipeline(socket, FakeRecognizer(), FakeTranslator())
        tasks = pipeline.start()
        segmenter = Segmenter()
        # 2.5 s into a sentence: interim lines are requested about once a second.
        for chunk in range(0, len(audio := pcm(("silence", 0.5), ("speech", 2.5))), 3200):
            for segment in segmenter.feed(audio[chunk : chunk + 3200]):
                pipeline.final(segment)
            pipeline.maybe_interim(segmenter)
            await asyncio.sleep(0)
        await asyncio.sleep(0.05)
        partials = [m for m in socket.sent if m["type"] == "partial"]
        assert partials and all(m["en"].endswith("of speech") for m in partials)
        assert partials[0]["offset"] == pytest.approx(0.3, abs=0.1)

        # A request still waiting when the sentence ends is never sent afterwards.
        pipeline.maybe_interim(segmenter)  # too soon: ignored
        segmenter.frames_seen += 100
        pipeline.maybe_interim(segmenter)
        pipeline.final(segmenter.flush())
        pipeline.finish()
        await asyncio.wait_for(asyncio.gather(*tasks), 2)
        kinds = [m["type"] for m in socket.sent]
        assert kinds[-2:] == ["caption", "translation"]
        assert kinds.count("partial") == len(partials)

    asyncio.run(scenario())


def test_an_empty_final_clears_the_interim_line():
    import asyncio

    from app.lecture_stream import CaptionPipeline, Segment

    class Silent(FakeRecognizer):
        def transcribe(self, audio, prompt):
            return ""

    async def scenario():
        socket = FakeSocket()
        pipeline = CaptionPipeline(socket, Silent(), FakeTranslator())
        tasks = pipeline.start()
        pipeline.final(Segment(1.0, np.zeros(SAMPLE_RATE, dtype=np.float32)))
        pipeline.finish()
        await asyncio.wait_for(asyncio.gather(*tasks), 2)
        assert socket.sent == [{"type": "partial", "en": None}]

    asyncio.run(scenario())


def test_translation_follows_sentences_and_captions_form_paragraphs():
    import asyncio

    from app.lecture_stream import CaptionPipeline, Segment

    texts = iter(
        [
            "So the gradient of the loss.",  # cut at the length limit, mid-sentence
            "With respect to the weights is zero. Now let's",
            "Next topic.",
        ]
    )

    class Scripted(FakeRecognizer):
        def transcribe(self, audio, prompt):
            return next(texts)

    def segment(offset, seconds, paused=True):
        return Segment(offset, np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32), paused)

    async def scenario():
        socket, translator = FakeSocket(), FakeTranslator()
        pipeline = CaptionPipeline(socket, Scripted(), translator)
        tasks = pipeline.start()

        async def settle():
            for _ in range(20):
                await asyncio.sleep(0.01)

        pipeline.idle(5)  # silence before anyone has spoken asks for nothing
        pipeline.final(segment(0, 5, paused=False))
        await settle()
        # The first piece is half a sentence: shown in English, not translated yet.
        assert [m["type"] for m in socket.sent] == ["caption"]
        assert socket.sent[0]["en"] == "So the gradient of the loss"

        pipeline.final(segment(5, 3))
        await settle()
        # The sentence is whole now and translated in one piece; "Now let's" is held back.
        first = "So the gradient of the loss With respect to the weights is zero."
        assert translator.calls == [(first, [])]
        assert socket.sent[-1]["id"] == 2 and socket.sent[-1]["upto"] == 1

        pipeline.idle(0.5)  # a short pause is not enough
        await settle()
        assert len(translator.calls) == 1
        pipeline.idle(1.3)
        pipeline.idle(1.4)  # asked once per silence
        await settle()
        assert translator.calls[1] == ("Now let's", [(first, f"译文：{first}")])
        assert socket.sent[-1]["id"] == 2 and socket.sent[-1]["upto"] == 2

        # After a long silence a new paragraph starts; a finished sentence is translated at once.
        pipeline.final(segment(14, 2))
        await settle()
        assert translator.calls[2] == (
            "Next topic.",
            [(first, f"译文：{first}"), ("Now let's", "译文：Now let's")],
        )
        pipeline.finish()
        await asyncio.wait_for(asyncio.gather(*tasks), 2)
        captions = [m for m in socket.sent if m["type"] == "caption"]
        assert [c["paragraph"] for c in captions] == [1, 1, 2]
        translations = [m for m in socket.sent if m["type"] == "translation"]
        assert [(t["id"], t["upto"]) for t in translations] == [(2, 1), (2, 2), (3, 3)]

    asyncio.run(scenario())


def test_sentences_are_held_until_finished_but_not_for_too_long():
    from app.lecture_stream import ready_length

    text = "We go downhill, e.g. along the slope. Then we repeat. And after"
    assert (
        text[: ready_length(text, False)] == "We go downhill, e.g. along the slope. Then we repeat."
    )
    assert ready_length("and after that we", False) == 0
    assert ready_length("and after that we", True) == len("and after that we")
    # About ten seconds without a full stop: translated anyway.
    rambling = " ".join(["word"] * 31)
    assert ready_length(rambling, False) == len(rambling)


def test_segmenter_reports_silence_and_forced_cuts():
    segmenter = Segmenter()
    segments = feed(segmenter, pcm(("silence", 0.5), ("speech", 8.0)))
    assert [s.paused for s in segments] == [False]
    assert segmenter.idle_seconds == 0  # still speaking
    segments = feed(segmenter, pcm(("silence", 2.0)))
    assert [s.paused for s in segments] == [True]
    assert segmenter.idle_seconds == pytest.approx(2.0, abs=0.1)


def expect_error(client, code, headers=ORIGIN):
    with client.websocket_connect("/api/v1/lecture/stream", headers=headers) as ws:
        messages = receive_until(ws, "error")
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
    assert messages[-1]["code"] == code


def test_stream_requires_login_and_allowed_origin(live):
    expect_error(live, "LECTURE_UNAUTHORIZED")
    register(live)
    login(live)
    expect_error(live, "LECTURE_ORIGIN_REJECTED", headers={"Origin": "https://evil.example"})
    expect_error(live, "LECTURE_ORIGIN_REJECTED", headers={})
    assert not live.app.state.live_lectures.active()


def test_one_stream_per_account_and_bad_audio(live):
    register(live)
    login(live)
    with live.websocket_connect("/api/v1/lecture/stream", headers=ORIGIN) as first:
        receive_until(first, "status", "listening")
        expect_error(live, "LECTURE_ALREADY_STREAMING")
        first.send_bytes(b"\x00\x01\x02")
        assert receive_until(first, "error")[-1]["code"] == "LECTURE_BAD_AUDIO"
    assert not live.app.state.live_lectures.active()


def test_missing_speech_model_is_reported(live):
    register(live)
    login(live)
    live.app.state.lecture_recognizer = FakeRecognizer("LECTURE_ASR_MODEL_MISSING")
    expect_error(live, "LECTURE_ASR_MODEL_MISSING")
    assert not live.app.state.live_lectures.active()


def test_background_summaries_wait_while_a_lecture_is_live(client):
    monitor = client.app.state.monitor
    lock = client.app.state.summary_lock
    live = client.app.state.live_lectures
    assert live.enter("someone")
    assert monitor.process_one() is False
    assert not lock.locked()
    live.leave("someone")
    assert LiveLectures().active() is False


def translator(response=None, status=200, seen=None, lock=None):
    def handle(request):
        if seen is not None:
            seen.update(json.loads(request.content))
        return httpx.Response(
            status, json=response or {"message": {"content": "“我们来讨论 Adam。”"}}
        )

    return QwenTranslator(
        lock or threading.Lock(), httpx.Client(transport=httpx.MockTransport(handle)), 0.05
    )


def test_translation_request_and_output_cleanup():
    seen = {}
    lock = threading.Lock()
    agent = translator(seen=seen, lock=lock)
    earlier = [("a", "甲"), ("b", "乙"), ("c", "丙")]
    assert agent.translate("Let's discuss Adam.", earlier) == "我们来讨论 Adam。"
    user = json.loads(seen["messages"][1]["content"])
    # The Chinese already shown goes along, so the model continues it instead of repeating it.
    assert user == {
        "previous": [{"en": "b", "zh": "乙"}, {"en": "c", "zh": "丙"}],
        "sentence": "Let's discuss Adam.",
    }
    assert seen["options"]["num_ctx"] == NUM_CTX and "tools" not in seen
    assert not lock.locked()


@pytest.mark.parametrize(
    "kwargs",
    [
        {"status": 500},
        {"response": {"message": {"content": "   "}}},
        {"response": {"message": {"content": "很长" * 200}}},
        {"response": {"unexpected": True}},
    ],
)
def test_translation_failures_return_none_and_release_the_lock(kwargs):
    lock = threading.Lock()
    assert translator(lock=lock, **kwargs).translate("Short sentence.", []) is None
    assert not lock.locked()


def test_translation_gives_up_when_the_model_stays_busy():
    lock = threading.Lock()
    lock.acquire()
    try:
        assert translator(lock=lock).translate("Hello.", []) is None
    finally:
        lock.release()


def test_recognizer_drops_silence_hallucinations():
    recognizer = WhisperRecognizer()
    outputs = iter(
        [
            {"segments": [{"text": " Thank you.", "no_speech_prob": 0.1, "avg_logprob": -0.2}]},
            {"segments": [{"text": " noise", "no_speech_prob": 0.9, "avg_logprob": -1.5}]},
            {
                "segments": [
                    {"text": " Gradient descent", "no_speech_prob": 0.1, "avg_logprob": -0.2}
                ]
            },
        ]
    )

    class Module:
        @staticmethod
        def transcribe(audio, **kwargs):
            assert kwargs["condition_on_previous_text"] is False and kwargs["language"] == "en"
            return next(outputs)

    recognizer.module, recognizer.path = Module, "/models/whisper"
    audio = np.zeros(SAMPLE_RATE, dtype=np.float32)
    assert "thank you." in HALLUCINATIONS
    assert [recognizer.transcribe(audio, None) for _ in range(3)] == ["", "", "Gradient descent"]
