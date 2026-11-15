// Runs on the audio thread. The AudioContext is created at 16 kHz, so the browser already
// resamples the microphone; this only converts to 16-bit PCM and batches 100 ms frames.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Int16Array(1600)
    this.filled = 0
    this.energy = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]))
      this.buffer[this.filled] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      this.energy += sample * sample
      this.filled += 1
      if (this.filled === this.buffer.length) {
        const level = Math.sqrt(this.energy / this.buffer.length)
        this.port.postMessage({ pcm: this.buffer.buffer, level }, [this.buffer.buffer])
        this.buffer = new Int16Array(1600)
        this.filled = 0
        this.energy = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCapture)
