// Minimal Chrome DevTools Protocol client: no dependencies, Node 24's built-in WebSocket.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export async function launch({
  width = 1920,
  height = 1080,
  audio = '',
  port = 9333,
  locale = 'zh-CN',
} = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'hkmate-video-'))
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    // Dates and times in form fields follow the language of the version being recorded.
    `--lang=${locale}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
    // The lecture scene: a WAV file plays as the microphone, permission is granted silently.
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    // The sandboxed audio service cannot open the WAV file.
    '--disable-features=AudioServiceSandbox,AudioServiceOutOfProcess',
    ...(audio ? [`--use-file-for-fake-audio-capture=${audio}`] : []),
    'about:blank',
  ]
  const child = spawn(CHROME, args, { stdio: 'ignore' })
  let target
  for (let attempt = 0; attempt < 50 && !target; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      target = pages.find((page) => page.type === 'page')
    } catch {
      // Chrome is still starting.
    }
  }
  if (!target) throw new Error('Chrome did not start')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let next = 0
  const pending = new Map()
  const listeners = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    } else for (const handler of listeners.get(message.method) || []) handler(message.params)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const on = (method, handler) =>
    listeners.set(method, [...(listeners.get(method) || []), handler])
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setLocaleOverride', { locale }).catch(() => {})
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  return {
    send,
    on,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description || result.exceptionDetails.text,
        )
      return result.result.value
    },
    async goto(url) {
      const loaded = new Promise((resolve) => on('Page.loadEventFired', resolve))
      await send('Page.navigate', { url })
      await loaded
    },
    async screenshot() {
      const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 93 })
      return Buffer.from(data, 'base64')
    },
    close() {
      socket.close()
      child.kill()
    },
  }
}
