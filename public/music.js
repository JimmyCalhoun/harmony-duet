export const DEGREES = [1, 2, 3, 4, 5, 4, 3, 2, 1];
export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const otherPart = part => part === 'melody' ? 'harmony' : 'melody';
export const midiFrequency = midi => 440 * 2 ** ((midi - 69) / 12);
export const frequencyMidi = hz => 69 + 12 * Math.log2(hz / 440);
export const noteName = midi => `${KEYS[((Math.round(midi) % 12) + 12) % 12]}${Math.floor(Math.round(midi) / 12) - 1}`;
export const tonicMidi = config => (config.octave + 1) * 12 + config.key;
export const degreeMidi = (config, degree) => tonicMidi(config) + MAJOR[degree - 1];
export const signature = config => JSON.stringify([config.key, config.octave, config.bpm, config.harmonyDegree, config.repeats]);
export const harmonyDegrees = config => config.harmonyDegree === '1-to-5'
  ? [1, 1, 1, 1, 5, 5, 5, 5, 5]
  : DEGREES.map(() => config.harmonyDegree);

export function makeTimeline(config, start = 0) {
  const beat = 60 / config.bpm;
  const steps = DEGREES.length * config.repeats;
  const harmony = harmonyDegrees(config);
  return {
    start, beat, steps, end: start + steps * beat,
    notes: Array.from({ length: steps }, (_, index) => ({
      index, start: start + index * beat, end: start + (index + 1) * beat,
      melody: degreeMidi(config, DEGREES[index % DEGREES.length]),
      harmony: degreeMidi(config, harmony[index % DEGREES.length])
    }))
  };
}

export function targetAt(timeline, time) {
  if (time < timeline.start || time >= timeline.end) return null;
  return timeline.notes[Math.min(timeline.steps - 1, Math.floor((time - timeline.start) / timeline.beat + 1e-8))];
}

export function assessPitch(hz, selectedMidi, otherMidi) {
  const midi = frequencyMidi(hz);
  const cents = (midi - selectedMidi) * 100;
  const otherCents = (midi - otherMidi) * 100;
  if (Math.abs(cents) <= 35) return { cents, kind: 'good', text: 'Holding your part' };
  if (selectedMidi !== otherMidi && Math.abs(otherCents) < 55 && Math.abs(otherCents) < Math.abs(cents)) {
    return { cents, kind: 'drift', text: 'On the other line — return to your note' };
  }
  if (Math.abs(cents) > 1100 && Math.abs(cents - Math.round(cents / 1200) * 1200) < 70) {
    return { cents, kind: 'near', text: 'Right pitch class, different octave' };
  }
  return {
    cents, kind: 'near',
    text: Math.abs(cents) > 150
      ? cents > 0 ? 'Above your target — return to your note' : 'Below your target — return to your note'
      : cents > 0 ? 'A little high — ease down' : 'A little low — lift gently'
  };
}

export function mixLevels(melody, harmony, selected, assistance, guide = true) {
  const levels = { melody, harmony };
  const baseline = guide ? levels[selected] : 0;
  const emphasized = Math.min(1, Math.max(0.7, baseline + 0.25));
  levels[selected] = baseline + assistance * (emphasized - baseline);
  levels[otherPart(selected)] *= 1 - 0.8 * assistance;
  return levels;
}

export function captureWindow(start, end, sampleRate) {
  return { startFrame: Math.round(start * sampleRate), endFrame: Math.round(end * sampleRate) };
}

export function wavBlob(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767), true));
  return new Blob([buffer], { type: 'audio/wav' });
}
