// One recording segment: microphone -> 16 kHz PCM -> WebSocket -> captions.
// Audio never leaves this machine (the backend runs locally) and is not stored anywhere.

export const STREAM_PATH = '/api/v1/lecture/stream'

export function streamUrl(location = window.location) {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}${STREAM_PATH}`
}

const MIC_ERRORS = {
  NotAllowedError: '浏览器没有获得麦克风权限，请在地址栏的网站设置中允许麦克风后重试。',
  NotFoundError: '没有找到可用的麦克风。',
  NotReadableError: '麦克风正被其他应用占用。',
}

/**
 * Starts recording and streaming. Handlers: onStatus(state), onPartial(msg) (the unfinished
 * sentence so far, or en: null to clear it), onCaption(msg), onTranslation(msg),
 * onLevel(0..1), onError(message), onClosed().
 * Returns { stop } which stops the microphone and lets pending captions finish.
 */
export async function startLectureStream(handlers, deps = {}) {
  const media = deps.mediaDevices ?? navigator.mediaDevices
  const makeContext = deps.makeContext ?? ((options) => new AudioContext(options))
  const makeSocket = deps.makeSocket ?? ((url) => new WebSocket(url))
  if (!media?.getUserMedia) throw new Error('当前浏览器不支持录音。')

  let stream
  try {
    stream = await media.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  } catch (cause) {
    throw new Error(MIC_ERRORS[cause?.name] || '无法打开麦克风。', { cause })
  }

  const context = makeContext({ sampleRate: 16000 })
  let node
  try {
    await context.audioWorklet.addModule('/pcm-capture-worklet.js')
    node = new (deps.WorkletNode ?? AudioWorkletNode)(context, 'pcm-capture')
  } catch (cause) {
    stream.getTracks().forEach((track) => track.stop())
    await context.close?.()
    throw new Error('浏览器无法启动录音处理，请使用最新版 Chrome 或 Safari。', { cause })
  }
  const source = context.createMediaStreamSource(stream)
  source.connect(node)
  node.connect(context.destination) // outputs silence; keeps the processor running

  const socket = makeSocket(streamUrl(deps.location))
  socket.binaryType = 'arraybuffer'
  let ready = false
  let micStopped = false

  function stopMicrophone() {
    if (micStopped) return
    micStopped = true
    node.port.onmessage = null
    try {
      source.disconnect()
      node.disconnect()
    } catch {
      // already disconnected
    }
    stream.getTracks().forEach((track) => track.stop())
    context.close?.()
  }

  node.port.onmessage = ({ data }) => {
    handlers.onLevel?.(Math.min(1, data.level * 6))
    if (ready && socket.readyState === 1) socket.send(data.pcm)
  }
  socket.onmessage = ({ data }) => {
    let message
    try {
      message = JSON.parse(data)
    } catch {
      return
    }
    if (message.type === 'status') {
      if (message.state === 'listening') ready = true
      handlers.onStatus?.(message.state)
    } else if (message.type === 'partial') handlers.onPartial?.(message)
    else if (message.type === 'caption') handlers.onCaption?.(message)
    else if (message.type === 'translation') handlers.onTranslation?.(message)
    else if (message.type === 'error') {
      stopMicrophone()
      handlers.onError?.(message.message || '实时字幕出错。')
    }
  }
  socket.onerror = () => {
    stopMicrophone()
    handlers.onError?.('无法连接实时字幕服务，请确认本地后端正在运行。')
  }
  socket.onclose = () => {
    stopMicrophone()
    handlers.onClosed?.()
  }

  return {
    stop() {
      stopMicrophone()
      handlers.onLevel?.(0)
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'stop' }))
      else if (socket.readyState === 0) socket.close()
    },
    abort() {
      stopMicrophone()
      socket.close()
    },
  }
}
