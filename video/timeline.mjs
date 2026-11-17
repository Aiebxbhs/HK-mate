// Turns the recorder's frames and marks into a constant 30 fps frame list for the encoder.
// Stretches marked with a speed (waiting for a model, a download) are played back faster.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), 'out')
const FPS = 30
const { frames, marks } = JSON.parse(readFileSync(join(out, 'frames.json'), 'utf8'))
const start = marks.find((mark) => mark.type === 'start')?.t ?? frames[0].t
const end = marks.find((mark) => mark.type === 'done')?.t ?? frames.at(-1).t

// Pieces of source time, each with one playback speed.
const pieces = []
let from = start
let speed = 1
for (const mark of marks.filter((item) => item.type === 'speed' && item.t > start && item.t < end)) {
  pieces.push({ from, to: mark.t, speed })
  from = mark.t
  speed = mark.value
}
pieces.push({ from, to: end, speed })

const sequence = []
let position = 0 // index into frames
for (const piece of pieces) {
  const count = Math.round(((piece.to - piece.from) / piece.speed / 1000) * FPS)
  for (let index = 0; index < count; index++) {
    const source = piece.from + (index / FPS) * 1000 * piece.speed
    while (position + 1 < frames.length && frames[position + 1].t <= source) position++
    sequence.push(join(out, 'frames', frames[position].file))
  }
}
writeFileSync(join(out, 'sequence.txt'), sequence.join('\n'))
const real = Math.round((end - start) / 1000)
const scenes = marks.filter((mark) => mark.type === 'scene').map((mark) => mark.name)
console.log(
  JSON.stringify({
    recordedSeconds: real,
    videoSeconds: Math.round(sequence.length / FPS),
    sourceFrames: frames.length,
    averageSourceFps: Math.round((frames.length / real) * 10) / 10,
    scenes,
  }),
)
