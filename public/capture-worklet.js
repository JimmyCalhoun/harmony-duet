class MicrophoneCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.window = null;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'arm') this.window = data;
      if (data.type === 'cancel') this.window = null;
    };
  }
  process(inputs) {
    const window = this.window;
    if (!window) return true;
    const channel = inputs[0]?.[0];
    const blockEnd = currentFrame + 128;
    if (channel && blockEnd > window.startFrame && currentFrame < window.endFrame) {
      const from = Math.max(0, window.startFrame - currentFrame);
      const to = Math.min(channel.length, window.endFrame - currentFrame);
      const samples = channel.slice(from, to);
      this.port.postMessage({ type: 'chunk', id: window.id, offset: currentFrame + from - window.startFrame, samples }, [samples.buffer]);
    }
    if (blockEnd >= window.endFrame) {
      this.port.postMessage({ type: 'done', id: window.id });
      this.window = null;
    }
    return true;
  }
}
registerProcessor('microphone-capture', MicrophoneCapture);
