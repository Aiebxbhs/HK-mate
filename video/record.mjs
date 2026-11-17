// Records the director page (video/director) from headless Chrome.
//   node video/record.mjs                 full recording into video/out/frames + frames.json
//   node video/record.mjs --only=a,b      only some scenes
//   node video/record.mjs --shots --fast  development: just the named still shots, quickly
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [name, value = '1'] = arg.replace(/^--/, '').split('=')
    return [name, value]
  }),
)
const out = join(here, 'out')
const frames = join(out, 'frames')
// --stills keeps the shots as clean screenshots, one folder per language.
const shots = args.stills ? join(out, 'stills', args.lang || 'zh') : join(out, 'shots')
const query = new URLSearchParams()
if (args.only) query.set('only', args.only)
if (args.fast) query.set('fast', '1')
if (args.lang) query.set('lang', args.lang)
if (args.stills) query.set('stills', '1')
const url = `http://127.0.0.1:8010/__video/index.html?${query}`

mkdirSync(shots, { recursive: true })
if (args.stills) args.shots = '1'
if (!args.shots) {
  rmSync(frames, { recursive: true, force: true })
  mkdirSync(frames, { recursive: true })
}

const chrome = await launch({
  audio: args.audio || join(out, 'lecture.wav'),
  locale: args.lang === 'en' ? 'en-GB' : 'zh-CN',
})
const index = [] // { file, t } with t in milliseconds since the epoch
const marks = []
const pendingShots = []
let finished
const done = new Promise((resolve) => (finished = resolve))

chrome.on('Runtime.consoleAPICalled', async ({ args: values }) => {
  const text = values?.[0]?.value
  if (typeof text !== 'string' || !text.startsWith('@@')) return
  const data = JSON.parse(text.slice(2))
  marks.push(data)
  if (data.type === 'shot') {
    const saved = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      writeFileSync(join(shots, `${data.name}.jpg`), await chrome.screenshot())
      console.log('shot', data.name)
    })()
    pendingShots.push(saved)
    await saved
  } else if (data.type === 'scene') console.log('scene', data.name)
  else if (data.type === 'error') {
    console.error('director error:', data.message)
    writeFileSync(join(shots, 'error.jpg'), await chrome.screenshot())
    finished(1)
  } else if (data.type === 'done') finished(0)
})
chrome.on('Runtime.exceptionThrown', ({ exceptionDetails }) =>
  console.error('page exception:', exceptionDetails.exception?.description || exceptionDetails.text),
)

if (!args.shots) {
  chrome.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = `${String(index.length).padStart(6, '0')}.jpg`
    writeFileSync(join(frames, file), Buffer.from(data, 'base64'))
    index.push({ file, t: Math.round(metadata.timestamp * 1000) })
    chrome.send('Page.screencastFrameAck', { sessionId })
  })
  await chrome.send('Page.startScreencast', { format: 'jpeg', quality: 93, everyNthFrame: 1 })
}

const started = Date.now()
await chrome.goto(url)
const timeout = setTimeout(() => finished(2), Number(args.timeout || 900) * 1000)
const code = await done
clearTimeout(timeout)
await Promise.allSettled(pendingShots)
if (!args.shots) {
  await chrome.send('Page.stopScreencast')
  writeFileSync(join(out, 'frames.json'), JSON.stringify({ frames: index, marks }))
}
console.log(
  JSON.stringify({ code, seconds: Math.round((Date.now() - started) / 1000), frames: index.length }),
)
chrome.close()
process.exit(code)
