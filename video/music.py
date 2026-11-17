"""Writes an original soundtrack for the intro video (no samples, no third-party music).

    .venv/bin/python video/music.py <seconds> <output.wav> [--opening=A|B|C] [--body=1|2|3|4|5]

Three parts, all synthesised here with numpy:
  1. the questions: a sound effect as each one pops up, over a slightly uneasy bed;
  2. the reveal: everything falls into one point and the music opens up as HK Mate appears;
  3. the body: the music under the rest of the film; it thins out now and then and fades at
     the end. Five styles: 1 warm, 2 laid-back, 3 quiet (no beat), 4 upbeat, 5 flowing
     solo piano.

The opening comes in three styles to choose from:
  A  bright   soft bubble pops, then bells and an airy chord
  B  cinematic  low knocks over a drone, a riser, then a wide warm swell
  C  playful  climbing marimba notes, a quick run up, and the beat starts at once

The times below are those of the opening scene in director/scenes.js.
"""

import sys
import wave

import numpy as np

RATE = 44100
BPM = 92
BEAT = 60 / BPM
BAR = 4 * BEAT

# When things happen in the opening (seconds from the first frame).
QUESTIONS = [0.45, 1.50, 2.40, 3.18, 3.85, 4.47]
COLLAPSE = 5.99
LOGO = 6.47
LINE = 7.37
PARTS = [8.27 + 0.26 * index for index in range(5)]
LIT = [10.07 + 0.23 * index for index in range(5)]
APP = 13.1

# C – G/B – Am7 – Fmaj7, then C – Em7 – Fmaj7 – G: bright without being busy. MIDI notes.
PROGRESSION = [
    (36, [60, 64, 67, 71]),
    (35, [59, 62, 67, 74]),
    (33, [57, 60, 64, 67]),
    (29, [57, 60, 65, 69]),
    (36, [60, 64, 67, 72]),
    (40, [59, 62, 64, 67]),
    (29, [57, 60, 65, 69]),
    (31, [59, 62, 67, 71]),
]


def hz(note: float) -> float:
    return 440.0 * 2 ** ((note - 69) / 12)


def clock(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * RATE)) / RATE


def smooth(signal: np.ndarray, width: int) -> np.ndarray:
    """A gentle low-pass: two passes of a moving average."""
    kernel = np.ones(width) / width
    return np.convolve(np.convolve(signal, kernel, mode="same"), kernel, mode="same")


# ---- instruments ------------------------------------------------------------------------------


def pad(notes: list[int], seconds: float, attack: float = 0.9, bright: float = 0.32) -> np.ndarray:
    t = clock(seconds)
    out = np.zeros_like(t)
    for note in notes:
        for detune in (-0.06, 0.05):
            f = hz(note + detune)
            out += np.sin(2 * np.pi * f * t) + bright * np.sin(4 * np.pi * f * t + 0.5)
            out += bright * 0.4 * np.sin(6 * np.pi * f * t)
    rise = np.clip(t / attack, 0, 1) ** 1.5
    fall = np.clip((seconds - t) / 0.9, 0, 1)
    return out * rise * fall / (len(notes) * 2)


def warm_swell(notes: list[int], seconds: float, attack: float) -> np.ndarray:
    """A fuller, brass-like pad that grows: many soft harmonics, opening up as it rises."""
    t = clock(seconds)
    out = np.zeros_like(t)
    opening = np.clip(t / attack, 0, 1)
    for note in notes:
        for detune in (-0.08, 0.07):
            f = hz(note + detune)
            for harmonic in range(1, 8):
                weight = (1 / harmonic) * np.clip(opening * 7 - (harmonic - 1) * 0.8, 0, 1)
                out += weight * np.sin(2 * np.pi * f * harmonic * t)
    fall = np.clip((seconds - t) / 1.2, 0, 1)
    return smooth(out, 7) * opening**1.2 * fall / (len(notes) * 2.4)


def pluck(note: int, seconds: float = 0.9) -> np.ndarray:
    t = clock(seconds)
    f = hz(note)
    tone = np.sin(2 * np.pi * f * t) + 0.45 * np.sin(4 * np.pi * f * t) * np.exp(-t * 9)
    tone += 0.2 * np.sin(6 * np.pi * f * t) * np.exp(-t * 14)
    return tone * np.exp(-t * 5.5) * np.clip(t / 0.004, 0, 1)


def bell(note: int, seconds: float = 2.4) -> np.ndarray:
    """Glockenspiel-like: a clear tone with two inharmonic partials that die away quickly."""
    t = clock(seconds)
    f = hz(note)
    tone = np.sin(2 * np.pi * f * t) * np.exp(-t * 2.4)
    tone += 0.36 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 6)
    tone += 0.18 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 11)
    return tone * np.clip(t / 0.003, 0, 1)


def marimba(note: int, seconds: float = 0.7) -> np.ndarray:
    t = clock(seconds)
    f = hz(note)
    tone = np.sin(2 * np.pi * f * t) * np.exp(-t * 7)
    tone += 0.3 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 22)
    return tone * np.clip(t / 0.003, 0, 1)


def bass(note: int, seconds: float) -> np.ndarray:
    t = clock(seconds)
    f = hz(note)
    tone = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    return tone * np.clip(t / 0.02, 0, 1) * np.exp(-t * 1.6)


def kick() -> np.ndarray:
    t = clock(0.28)
    sweep = 48 + 70 * np.exp(-t * 38)
    return np.sin(2 * np.pi * np.cumsum(sweep) / RATE) * np.exp(-t * 13)


def hat(rng: np.random.Generator) -> np.ndarray:
    t = clock(0.07)
    noise = rng.standard_normal(len(t))
    noise = noise - smooth(noise, 9)  # keep only the airy top
    return noise * np.exp(-t * 70)


# ---- sound effects ----------------------------------------------------------------------------


def bubble_pop(pitch: float) -> np.ndarray:
    """A soft "bloop": a tone that jumps up quickly and vanishes."""
    t = clock(0.16)
    sweep = pitch * (0.55 + 0.75 * np.clip(t / 0.05, 0, 1))
    return np.sin(2 * np.pi * np.cumsum(sweep) / RATE) * np.exp(-t * 26) * np.clip(t / 0.002, 0, 1)


def knock(rng: np.random.Generator, pitch: float) -> np.ndarray:
    """A low, dry knock with a little click on top."""
    t = clock(0.3)
    sweep = pitch * (1 + 1.4 * np.exp(-t * 60))
    body = np.sin(2 * np.pi * np.cumsum(sweep) / RATE) * np.exp(-t * 17)
    click = rng.standard_normal(len(t)) * np.exp(-t * 300) * 0.35
    return body + click


def riser(rng: np.random.Generator, seconds: float) -> np.ndarray:
    """Air rushing in: noise and a rising tone that grow until they are cut off."""
    t = clock(seconds)
    noise = rng.standard_normal(len(t))
    noise = noise - smooth(noise, 25)
    sweep = 180 * (2 ** (t / seconds * 2.6))
    tone = np.sin(2 * np.pi * np.cumsum(sweep) / RATE) * 0.35
    return (noise * 0.5 + tone) * (t / seconds) ** 2.4


def impact(rng: np.random.Generator) -> np.ndarray:
    """A soft, deep landing with a wash of air that settles."""
    t = clock(2.6)
    low = np.sin(2 * np.pi * np.cumsum(42 + 60 * np.exp(-t * 18)) / RATE) * np.exp(-t * 4.5)
    air = rng.standard_normal(len(t))
    air = (air - smooth(air, 15)) * np.exp(-t * 2.6) * 0.22
    return low + air


def shimmer(rng: np.random.Generator, seconds: float) -> np.ndarray:
    """Very quiet sparkling air, for the moment the picture opens up."""
    t = clock(seconds)
    air = rng.standard_normal(len(t))
    air = air - smooth(air, 5)
    return air * np.clip(t / 0.3, 0, 1) * np.exp(-t * 1.5) * 0.12


def uneasy_bed(seconds: float) -> np.ndarray:
    """Two low tones a semitone apart, slowly growing: nothing has been answered yet."""
    t = clock(seconds)
    tone = np.sin(2 * np.pi * 110 * t) + np.sin(2 * np.pi * 116.5 * t)
    tone += 0.5 * np.sin(2 * np.pi * 55 * t)
    return tone * (0.25 + 0.75 * t / seconds) * np.clip(t / 0.4, 0, 1) / 2.5


# ---- putting it together ----------------------------------------------------------------------


def add(track: np.ndarray, sound: np.ndarray, at: float, gain: float) -> None:
    start = int(at * RATE)
    if start >= len(track) or start < 0:
        return
    end = min(len(track), start + len(sound))
    track[start:end] += sound[: end - start] * gain


def epiano(note: int, seconds: float = 1.6) -> np.ndarray:
    """A mellow electric-piano note with a slow wobble."""
    t = clock(seconds)
    f = hz(note)
    tone = np.sin(2 * np.pi * f * t) + 0.22 * np.sin(4 * np.pi * f * t) * np.exp(-t * 5)
    tone += 0.1 * np.sin(2 * np.pi * f * 7 * t) * np.exp(-t * 30)  # a little bark at the start
    wobble = 1 + 0.12 * np.sin(2 * np.pi * 4.6 * t)
    return tone * wobble * np.exp(-t * 2.2) * np.clip(t / 0.006, 0, 1)


def rim(rng: np.random.Generator) -> np.ndarray:
    """A soft snare-like tap."""
    t = clock(0.16)
    noise = rng.standard_normal(len(t))
    noise = smooth(noise, 3) - smooth(noise, 21)
    return (noise * 0.8 + 0.5 * np.sin(2 * np.pi * 210 * t)) * np.exp(-t * 34)


def echoed(track: np.ndarray, beat: float, amount: float = 0.34) -> np.ndarray:
    delay = int(beat * 0.75 * RATE)
    echo = np.zeros(len(track))
    echo[delay:] = track[:-delay] * amount
    echo[2 * delay :] += track[: -2 * delay] * amount * 0.4
    return echo


def body_warm(total: int, begins: float, rng: np.random.Generator) -> np.ndarray:
    """1  warm: a plucked arpeggio over a soft pad, a round bass and a very light beat."""
    seconds = total / RATE
    pads, plucks, low, drums = (np.zeros(total) for _ in range(4))
    kick_sound = kick()
    arpeggio = [0, 2, 1, 3, 2, 1, 3, 2]
    for index in range(int((seconds - begins) / BAR) + 1):
        start = begins + index * BAR
        root, chord = PROGRESSION[index % len(PROGRESSION)]
        breather = (index // 8) % 4 == 3  # every fourth phrase thins out
        add(pads, pad(chord, BAR + 0.9), start, 1.0)
        add(low, bass(root + 12, BEAT * 1.9), start, 1.0)
        add(low, bass(root + 12, BEAT * 1.4), start + BEAT * 2.5, 0.7)
        for step in range(8):
            if breather and step % 2:
                continue
            note = chord[arpeggio[(step + index) % 8] % len(chord)] + 12
            add(plucks, pluck(note), start + step * BEAT / 2, 0.55 if step % 4 else 0.8)
        if not breather:
            add(drums, kick_sound, start, 1.0)
            add(drums, kick_sound, start + BEAT * 2, 0.8)
            for step in range(1, 8, 2):
                add(drums, hat(rng), start + step * BEAT / 2, 0.16)
    mix = smooth(pads, 5) * 0.26 + plucks * 0.19 + echoed(plucks, BEAT) * 0.18
    return mix + low * 0.3 + drums * 0.34


def body_lofi(total: int, begins: float, rng: np.random.Generator) -> np.ndarray:
    """2  laid-back: slow electric-piano chords, a lazy beat with a soft tap on two and four."""
    beat = 60 / 78
    bar = 4 * beat
    chords = [  # Fmaj7 – Em7 – Dm7 – Cmaj7, then Fmaj7 – G6 – Am7 – Cmaj7
        (29, [57, 60, 64, 69]),
        (28, [55, 59, 62, 67]),
        (26, [57, 60, 62, 65]),
        (24, [55, 59, 60, 64]),
        (29, [57, 60, 64, 69]),
        (31, [55, 59, 62, 64]),
        (33, [55, 57, 60, 64]),
        (24, [55, 59, 60, 67]),
    ]
    seconds = total / RATE
    keys, low, drums, top = (np.zeros(total) for _ in range(4))
    kick_sound = kick()
    for index in range(int((seconds - begins) / bar) + 1):
        start = begins + index * bar
        root, chord = chords[index % len(chords)]
        breather = (index // 8) % 4 == 3
        for hit, gain in ((0, 1.0), (beat * 1.5, 0.6), (beat * 2.5, 0.75)):
            for offset, note in enumerate(chord):
                add(keys, epiano(note + 12, 1.9), start + hit + offset * 0.012, gain * 0.5)
        add(low, bass(root + 12, beat * 2.2), start, 1.0)
        add(low, bass(root + 12, beat * 1.2), start + beat * 2.5, 0.6)
        if index % 2 == 1:  # a short answering phrase every other bar
            for step, note in enumerate([chord[3] + 12, chord[2] + 12, chord[3] + 12]):
                add(top, bell(note, 1.2), start + beat * (2 + step * 0.5), 0.5)
        if not breather:
            add(drums, kick_sound, start, 1.0)
            add(drums, kick_sound, start + beat * 2.5, 0.75)
            add(drums, rim(rng), start + beat, 0.5)
            add(drums, rim(rng), start + beat * 3, 0.5)
            for step in range(8):  # swung: the off-beats arrive a little late
                late = beat * 0.09 if step % 2 else 0
                add(drums, hat(rng), start + step * beat / 2 + late, 0.13 if step % 2 else 0.07)
    mix = smooth(keys, 7) * 0.34 + low * 0.3 + drums * 0.3
    return mix + top * 0.1 + echoed(top, beat) * 0.1


def body_ambient(total: int, begins: float, rng: np.random.Generator) -> np.ndarray:
    """3  quiet: no beat at all; slow chords and a few bell notes, staying out of the way."""
    beat = 60 / 72
    seconds = total / RATE
    pads, bells, low = (np.zeros(total) for _ in range(3))
    span = 8 * beat  # each chord lasts two bars
    for index in range(int((seconds - begins) / span) + 1):
        start = begins + index * span
        root, chord = PROGRESSION[(index * 2) % len(PROGRESSION)]
        add(
            pads,
            pad([root + 12, *chord, chord[0] + 12], span + 2.5, attack=2.2, bright=0.25),
            start,
            1.0,
        )
        add(low, bass(root + 12, span * 0.8) * 0.6, start, 1.0)
        notes = rng.permutation(
            [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[3] + 12, chord[0] + 24]
        )
        for step, note in enumerate(notes[:4]):
            add(bells, bell(int(note), 3.0), start + beat * (1 + step * 1.75), 0.5 - step * 0.06)
    mix = smooth(pads, 9) * 0.42 + low * 0.24
    return mix + bells * 0.13 + echoed(bells, beat, 0.5) * 0.13


def body_upbeat(total: int, begins: float, rng: np.random.Generator) -> np.ndarray:
    """4  upbeat: quicker, short muted notes on every eighth, a steady soft kick and a clap."""
    beat = 60 / 108
    bar = 4 * beat
    chords = [  # C – Am7 – Fmaj7 – G, then C – Em7 – Fmaj7 – Gsus
        (36, [60, 64, 67, 72]),
        (33, [57, 60, 64, 67]),
        (29, [57, 60, 65, 69]),
        (31, [59, 62, 67, 71]),
        (36, [60, 64, 67, 74]),
        (40, [59, 62, 64, 67]),
        (29, [57, 60, 65, 69]),
        (31, [60, 62, 67, 72]),
    ]
    seconds = total / RATE
    pads, plucks, low, drums, top = (np.zeros(total) for _ in range(5))
    kick_sound = kick()
    pattern = [0, 1, 2, 1, 3, 1, 2, 1]
    for index in range(int((seconds - begins) / bar) + 1):
        start = begins + index * bar
        root, chord = chords[index % len(chords)]
        breather = (index // 8) % 4 == 3
        add(pads, pad(chord, bar + 0.6, attack=0.3), start, 1.0)
        for step in range(8):
            note = chord[pattern[step]] + 12
            add(
                plucks, marimba(note, 0.28), start + step * beat / 2, 0.75 if step % 2 == 0 else 0.5
            )
        for step in (0, 1.5, 2, 3.5):
            add(
                low,
                bass(root + 12 + (12 if step in (1.5, 3.5) else 0), beat * 0.8),
                start + step * beat,
                0.9,
            )
        if index % 4 == 3:  # a small lift at the end of each line
            for step, note in enumerate(
                [chord[2] + 12, chord[3] + 12, chord[3] + 14, chord[3] + 19]
            ):
                add(top, bell(note, 0.9), start + beat * (2 + step * 0.5), 0.5)
        if not breather:
            for step in range(4):
                add(drums, kick_sound, start + step * beat, 0.9 if step % 2 == 0 else 0.7)
            add(drums, rim(rng), start + beat, 0.55)
            add(drums, rim(rng), start + beat * 3, 0.55)
            for step in range(1, 8, 2):
                add(drums, hat(rng), start + step * beat / 2, 0.17)
    mix = smooth(pads, 5) * 0.22 + plucks * 0.2 + echoed(plucks, beat, 0.22) * 0.16
    return mix + low * 0.28 + drums * 0.32 + top * 0.1


def piano(note: int, seconds: float = 3.2, velocity: float = 1.0) -> np.ndarray:
    """A soft piano note: many partials, the high ones dying first, a little hammer thump."""
    t = clock(seconds)
    f = hz(note)
    tone = np.zeros_like(t)
    for n in range(1, 11):
        partial = f * n * np.sqrt(1 + 0.0004 * n * n)  # strings are slightly sharp up high
        if partial > 9000:
            break
        weight = velocity ** (0.6 + 0.12 * n) / n**1.35
        tone += weight * np.sin(2 * np.pi * partial * t) * np.exp(-t * (0.9 + 0.55 * n))
    thump = np.sin(2 * np.pi * 90 * t) * np.exp(-t * 60) * 0.05
    return (tone + thump) * np.clip(t / 0.005, 0, 1) * np.clip((seconds - t) / 0.3, 0, 1)


def room(track: np.ndarray) -> np.ndarray:
    """A small hall: a handful of soft, darkening reflections."""
    out = track.copy()
    for delay, gain in (
        (0.031, 0.22),
        (0.047, 0.18),
        (0.073, 0.15),
        (0.113, 0.12),
        (0.173, 0.09),
        (0.251, 0.07),
    ):
        shift = int(delay * RATE)
        out[shift:] += smooth(track, 9)[:-shift] * gain
    return out


def body_piano(total: int, begins: float, rng: np.random.Generator) -> np.ndarray:
    """5  flowing piano: an original solo-piano piece, a rolling left hand under a singing line.

    Written for this film in the gentle, flowing style of contemporary solo piano; the melody
    and its accompaniment are our own, not taken from any existing piece.
    """
    beat = 60 / 66
    eighth = beat / 2
    bar = 4 * beat
    # Fmaj7 – G – Em7 – Am – Dm7 – G – C – C/E: (bass note, the tones the left hand rolls through)
    harmony = [
        (41, [48, 53, 57, 60, 64]),
        (43, [50, 55, 59, 62, 67]),
        (40, [47, 52, 55, 59, 62]),
        (45, [52, 57, 60, 64, 69]),
        (38, [50, 53, 57, 60, 65]),
        (43, [50, 55, 59, 62, 65]),
        (36, [48, 52, 55, 60, 64]),
        (40, [48, 52, 55, 60, 67]),
    ]
    roll = [0, 1, 2, 3, 4, 3, 2, 1]
    # The line the right hand sings: (note, length in eighths) for each of the eight bars.
    melody = [
        [(69, 2), (72, 2), (76, 1), (74, 1), (72, 2)],
        [(71, 2), (74, 2), (79, 2), (74, 2)],
        [(76, 3), (74, 1), (71, 2), (67, 2)],
        [(72, 2), (69, 2), (64, 2), (69, 2)],
        [(65, 2), (69, 2), (74, 1), (72, 1), (69, 2)],
        [(67, 2), (71, 2), (74, 2), (79, 2)],
        [(76, 4), (72, 2), (67, 2)],
        [(72, 6), (0, 2)],
    ]
    # A second line that answers it, climbing higher before it settles.
    answer = [
        [(76, 2), (77, 1), (76, 1), (72, 2), (69, 2)],
        [(74, 3), (79, 1), (83, 2), (79, 2)],
        [(79, 2), (76, 2), (74, 2), (71, 2)],
        [(72, 4), (76, 2), (81, 2)],
        [(77, 2), (74, 2), (69, 2), (65, 2)],
        [(71, 2), (74, 2), (79, 3), (77, 1)],
        [(76, 2), (72, 2), (67, 2), (64, 2)],
        [(72, 8)],
    ]
    seconds = total / RATE
    keys = np.zeros(total)
    for index in range(int((seconds - begins) / bar) + 1):
        start = begins + index * bar
        phrase, position = divmod(index, 8)
        root, tones = harmony[position]
        kind = phrase % 4  # 0 the tune, 1 the same an octave up, 2 the answer, 3 left hand alone
        soft = 0.75 if kind == 3 else 1.0
        add(keys, piano(root, 4.0, 0.7), start, 0.5 * soft)
        for step in range(8):
            when = start + step * eighth + rng.normal(0, 0.006)
            add(keys, piano(tones[roll[step]], 2.4, 0.55), when, (0.34 if step else 0.42) * soft)
        if kind == 3:
            continue
        line = answer[position] if kind == 2 else melody[position]
        lift = 12 if kind == 1 else 0
        when = start
        for note, length in line:
            if note:
                loud = 0.85 + rng.normal(0, 0.05)
                add(
                    keys,
                    piano(note + lift, 1.4 + length * 0.55, loud),
                    when + rng.normal(0, 0.008),
                    0.62,
                )
            when += length * eighth
    return room(keys) * 0.42


BODIES = {
    "1": body_warm,
    "2": body_lofi,
    "3": body_ambient,
    "4": body_upbeat,
    "5": body_piano,
}


def opening(style: str, total: int, rng: np.random.Generator) -> tuple[np.ndarray, float]:
    """The questions and the reveal in one style; also when the body should come in."""
    out = np.zeros(total)
    if style == "A":
        # Soft bubbles, each a little higher, over a faint unsettled hum.
        add(out, uneasy_bed(COLLAPSE), 0, 0.10)
        for index, at in enumerate(QUESTIONS):
            add(out, bubble_pop(520 * 2 ** (index * 2 / 12)), at, 0.5)
        # They fall together, then bells and an airy chord open up.
        add(out, riser(rng, LOGO - COLLAPSE), COLLAPSE, 0.22)
        add(out, pad([48, 55, 64, 67, 74], APP - LOGO + 1.5, attack=0.5, bright=0.5), LOGO, 0.42)
        add(out, shimmer(rng, 3.0), LOGO, 1.0)
        for step, note in enumerate([72, 76, 79, 84, 88]):
            add(out, bell(note), LOGO + step * 0.11, 0.3 - step * 0.02)
        add(out, bell(86), LINE, 0.26)
        add(out, bell(79), LINE + 0.12, 0.2)
        for note, at in zip([72, 74, 76, 79, 84], PARTS):
            add(out, bell(note, 1.6), at, 0.22)
        for note, at in zip([84, 86, 88, 91, 96], LIT):
            add(out, bell(note, 1.4), at, 0.17)
        return out, APP
    if style == "B":
        # Low knocks over a growing drone, like a to-do list piling up.
        add(out, uneasy_bed(COLLAPSE), 0, 0.3)
        for index, at in enumerate(QUESTIONS):
            add(out, knock(rng, 82 + index * 5), at, 0.6)
        # A rush of air, a soft landing, and a wide warm chord that keeps opening.
        add(out, riser(rng, LOGO - COLLAPSE + 0.25), COLLAPSE - 0.25, 0.5)
        add(out, impact(rng), LOGO, 0.6)
        add(out, warm_swell([36, 48, 55, 60, 64, 67], APP - LOGO + 2.0, attack=3.2), LOGO, 0.62)
        add(out, shimmer(rng, 4.0), LOGO, 1.2)
        add(out, bell(84, 3.0), LINE, 0.16)
        for note, at in zip([67, 72, 74, 76, 79], PARTS):
            add(out, bell(note, 1.8), at, 0.14)
        add(out, warm_swell([41, 53, 57, 60, 64, 69], 3.4, attack=1.2), LIT[0], 0.4)
        return out, APP
    # C: a curious little tune that keeps climbing without landing.
    for index, (note, at) in enumerate(zip([64, 66, 68, 70, 72, 74], QUESTIONS)):
        add(out, marimba(note), at, 0.5)
        add(out, marimba(note - 12), at, 0.2)
        if index >= 3:
            add(out, marimba(note + 6), at + 0.16, 0.25)
    # A quick run up and a bright chord: the beat starts with the logo.
    for step, note in enumerate([67, 69, 71, 72, 74, 76, 79, 83]):
        add(out, marimba(note, 0.4), COLLAPSE + step * 0.055, 0.3 + step * 0.03)
    add(out, pad([48, 60, 64, 67, 72, 76], 2.6, attack=0.03, bright=0.6), LOGO, 0.5)
    add(out, bell(84, 2.0), LOGO, 0.3)
    add(out, shimmer(rng, 2.0), LOGO, 1.0)
    for note, at in zip([76, 79, 81, 84, 88], PARTS):
        add(out, bell(note, 1.2), at, 0.2)
    for note, at in zip([88, 91, 93, 96, 100], LIT):
        add(out, bell(note, 1.0), at, 0.14)
    return out, LOGO


def render(seconds: float, style: str, body: str = "1") -> np.ndarray:
    total = int(seconds * RATE)
    rng = np.random.default_rng(7)
    intro, begins = opening(style, total, rng)
    mono = intro * 0.9 + BODIES[body](total, begins, rng)
    # A touch of width: the right channel hears the same thing a few milliseconds later.
    stereo = np.stack([mono, 0.92 * np.roll(mono, 230) + 0.08 * mono], axis=1)
    t = np.arange(total) / RATE
    stereo *= (np.clip(t / 0.15, 0, 1) * np.clip((seconds - t) / 5.0, 0, 1))[:, None]
    return stereo / np.max(np.abs(stereo)) * 0.62


def main() -> None:
    seconds, output = float(sys.argv[1]), sys.argv[2]
    style = next((arg.split("=")[1] for arg in sys.argv[3:] if arg.startswith("--opening=")), "A")
    body = next((arg.split("=")[1] for arg in sys.argv[3:] if arg.startswith("--body=")), "1")
    # A shorter opening (the highlight reel): the body comes in when the app appears.
    for arg in sys.argv[3:]:
        if arg.startswith("--app="):
            global APP
            APP = float(arg.split("=")[1])
    audio = render(seconds, style, body)
    with wave.open(output, "wb") as file:
        file.setnchannels(2)
        file.setsampwidth(2)
        file.setframerate(RATE)
        file.writeframes((audio * 32767).astype("<i2").tobytes())
    rms = float(np.sqrt(np.mean(audio**2)))
    print(f"wrote {output}: opening {style}, body {body}, {seconds:.1f} s, rms {rms:.3f}")


if __name__ == "__main__":
    main()
