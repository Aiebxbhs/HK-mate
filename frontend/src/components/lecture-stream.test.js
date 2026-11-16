import { expect, it, vi } from 'vitest'
import {
  listMicrophones,
  readMicSettings,
  startLectureStream,
  streamUrl,
  writeMicSettings,
} from './lecture-stream'

function fakes({ micError } = {}) {
  const track = { stop: vi.fn() }
  const sent = []
  const socket = { readyState: 1, send: (data) => sent.push(data), close: vi.fn() }
  const node = { port: {}, connect: vi.fn(), disconnect: vi.fn() }
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const context = {
    audioWorklet: { addModule: vi.fn().mockResolvedValue() },
    createMediaStreamSource: vi.fn(() => source),
    destination: {},
    close: vi.fn(),
  }
  const deps = {
    mediaDevices: {
      getUserMedia: micError
        ? vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: micError }))
        : vi.fn().mockResolvedValue({ getTracks: () => [track] }),
    },
    makeContext: vi.fn(() => context),
    makeSocket: vi.fn(() => socket),
    WorkletNode: function WorkletNode() {
      return node
    },
    location: { protocol: 'http:', host: '127.0.0.1:5173' },
  }
  return { deps, socket, node, track, sent, context }
}

it('builds the WebSocket URL for the current page', () => {
  expect(streamUrl({ protocol: 'http:', host: '127.0.0.1:5173' })).toBe(
    'ws://127.0.0.1:5173/api/v1/lecture/stream',
  )
  expect(streamUrl({ protocol: 'https:', host: 'mate.test' })).toBe(
    'wss://mate.test/api/v1/lecture/stream',
  )
})

it('streams audio only after the server is listening, and stops the microphone', async () => {
  const { deps, socket, node, track, sent, context } = fakes()
  const handlers = {
    onStatus: vi.fn(),
    onPartial: vi.fn(),
    onCaption: vi.fn(),
    onTranslation: vi.fn(),
    onLevel: vi.fn(),
    onClosed: vi.fn(),
  }
  const handle = await startLectureStream(handlers, deps)
  expect(deps.makeContext).toHaveBeenCalledWith({ sampleRate: 16000 })
  expect(deps.mediaDevices.getUserMedia.mock.calls[0][0].audio).toMatchObject({
    channelCount: 1,
    // Classroom pickup: the browser must not treat a distant lecturer as background noise.
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true,
  })
  const frame = new ArrayBuffer(3200)
  node.port.onmessage({ data: { pcm: frame, level: 0.05 } })
  expect(sent).toEqual([]) // model still loading
  socket.onmessage({ data: JSON.stringify({ type: 'status', state: 'listening' }) })
  node.port.onmessage({ data: { pcm: frame, level: 0.05 } })
  expect(sent).toEqual([frame])
  expect(handlers.onLevel.mock.calls.at(-1)[0]).toBeCloseTo(0.3)

  socket.onmessage({ data: JSON.stringify({ type: 'partial', offset: 1, en: 'H' }) })
  expect(handlers.onPartial).toHaveBeenCalledWith({ type: 'partial', offset: 1, en: 'H' })
  socket.onmessage({ data: JSON.stringify({ type: 'caption', id: 1, en: 'Hi' }) })
  socket.onmessage({ data: JSON.stringify({ type: 'translation', id: 1, zh: '你好' }) })
  socket.onmessage({ data: 'not json' })
  expect(handlers.onCaption).toHaveBeenCalledWith({ type: 'caption', id: 1, en: 'Hi' })
  expect(handlers.onTranslation).toHaveBeenCalledWith({ type: 'translation', id: 1, zh: '你好' })

  handle.stop()
  expect(track.stop).toHaveBeenCalled()
  expect(context.close).toHaveBeenCalled()
  expect(sent.at(-1)).toBe(JSON.stringify({ type: 'stop' }))
  socket.onclose()
  expect(handlers.onClosed).toHaveBeenCalled()
})

it('turns microphone and server errors into readable messages', async () => {
  await expect(startLectureStream({}, fakes({ micError: 'NotAllowedError' }).deps)).rejects.toThrow(
    '浏览器没有获得麦克风权限',
  )
  const { deps, socket, track } = fakes()
  const onError = vi.fn()
  await startLectureStream({ onError }, deps)
  socket.onmessage({
    data: JSON.stringify({
      type: 'error',
      code: 'LECTURE_ASR_MODEL_MISSING',
      message: '未找到 Whisper 模型',
    }),
  })
  expect(onError).toHaveBeenCalledWith('未找到 Whisper 模型')
  expect(track.stop).toHaveBeenCalled()
})

it('uses the chosen microphone and noise reduction, falling back when it is unplugged', async () => {
  localStorage.clear()
  expect(readMicSettings()).toEqual({ deviceId: '', voiceProcessing: false })
  writeMicSettings({ deviceId: 'usb-1', voiceProcessing: true })
  expect(readMicSettings()).toEqual({ deviceId: 'usb-1', voiceProcessing: true })
  localStorage.setItem('hkmate.lecture.mic', 'not json')
  expect(readMicSettings()).toEqual({ deviceId: '', voiceProcessing: false })

  const { deps } = fakes()
  await startLectureStream({}, deps, { deviceId: 'usb-1', voiceProcessing: true })
  expect(deps.mediaDevices.getUserMedia.mock.calls[0][0].audio).toMatchObject({
    deviceId: { exact: 'usb-1' },
    echoCancellation: true,
    noiseSuppression: true,
  })

  const unplugged = fakes()
  unplugged.deps.mediaDevices.getUserMedia
    .mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'OverconstrainedError' }))
    .mockResolvedValueOnce({ getTracks: () => [unplugged.track] })
  await startLectureStream({}, unplugged.deps, { deviceId: 'usb-1', voiceProcessing: false })
  const second = unplugged.deps.mediaDevices.getUserMedia.mock.calls[1][0].audio
  expect(second.deviceId).toBeUndefined()
  expect(second.noiseSuppression).toBe(false)
})

it('lists only microphones the browser can name', async () => {
  const media = {
    enumerateDevices: vi.fn().mockResolvedValue([
      { kind: 'audioinput', deviceId: 'usb-1', label: 'USB Microphone' },
      { kind: 'audioinput', deviceId: '', label: '' }, // before permission is granted
      { kind: 'videoinput', deviceId: 'cam', label: 'Camera' },
    ]),
  }
  expect(await listMicrophones(media)).toEqual([{ id: 'usb-1', label: 'USB Microphone' }])
  expect(await listMicrophones(undefined)).toEqual([])
  expect(
    await listMicrophones({ enumerateDevices: () => Promise.reject(new Error('no')) }),
  ).toEqual([])
})
