// Downsampling bounds the YIN difference calculation independently of device sample rate.
export function detectPitch(input, sampleRate) {
  const stride = Math.max(1, Math.floor(sampleRate / 16000));
  const rate = sampleRate / stride;
  const size = Math.floor(input.length / stride);
  const data = new Float32Array(size);
  let energy = 0;
  for (let i = 0; i < size; i++) {
    let sum = 0;
    for (let j = 0; j < stride; j++) sum += input[i * stride + j];
    data[i] = sum / stride;
    energy += data[i] ** 2;
  }
  if (Math.sqrt(energy / size) < 0.008) return null;
  const maxLag = Math.min(Math.floor(rate / 65), Math.floor(size / 2));
  const minLag = Math.max(2, Math.floor(rate / 2000));
  const difference = new Float32Array(maxLag + 1);
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < size - maxLag; i++) sum += (data[i] - data[i + lag]) ** 2;
    difference[lag] = sum;
    running += sum;
    difference[lag] = running ? sum * lag / running : 1;
  }
  for (let lag = minLag; lag < maxLag - 1; lag++) {
    if (difference[lag] < 0.14) {
      while (lag + 1 < maxLag && difference[lag + 1] < difference[lag]) lag++;
      const a = difference[lag - 1], b = difference[lag], c = difference[lag + 1];
      const denominator = 2 * (2 * b - a - c);
      const refined = lag + (denominator ? (c - a) / denominator : 0);
      return rate / refined;
    }
  }
  return null;
}
