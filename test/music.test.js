import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { DEGREES, degreeMidi, noteName, midiFrequency, makeTimeline, targetAt, signature, assessPitch, mixLevels, captureWindow, wavBlob } from '../public/music.js';
import { detectPitch } from '../public/pitch.js';

const config = { key: 0, octave: 4, bpm: 90, harmonyDegree: 1, repeats: 1 };
test('major scale is 1 2 3 4 5 4 3 2 1 in the chosen key and octave', () => {
  assert.deepEqual(DEGREES.map(degree => noteName(degreeMidi(config, degree))), ['C4','D4','E4','F4','G4','F4','E4','D4','C4']);
  assert.equal(noteName(degreeMidi({ ...config, key: 11, octave: 3 }, 5)), 'F#4');
  assert.equal(degreeMidi({ ...config, octave: 3 }, 1), 48);
});
test('both lines use the same absolute sample-clock timeline over repetitions', () => {
  const timeline = makeTimeline({ ...config, harmonyDegree: 5, repeats: 2, bpm: 120 }, 12.25);
  assert.equal(timeline.notes.length, 18);
  assert.equal(timeline.end, 21.25);
  assert.equal(timeline.notes[9].start, 16.75);
  assert.ok(timeline.notes.every(note => note.harmony === 67 && note.end - note.start === 0.5));
  assert.equal(targetAt(timeline, 12.249), null);
  assert.equal(targetAt(timeline, 12.75).index, 1);
  assert.equal(targetAt(timeline, timeline.end), null);
});
test('every musically incompatible setting invalidates saved take', () => {
  for (const key of Object.keys(config)) assert.notEqual(signature(config), signature({ ...config, [key]: config[key] + 1 }));
  assert.equal(signature(config), signature({ ...config, volume: 0.7 }));
});
test('feedback detects the other line and does not warn where parts meet', () => {
  assert.equal(assessPitch(midiFrequency(60), 64, 60).kind, 'drift');
  assert.equal(assessPitch(midiFrequency(60), 60, 60).kind, 'good');
  assert.equal(assessPitch(midiFrequency(64), 60, 64).kind, 'drift');
  assert.match(assessPitch(midiFrequency(72), 60, 67).text, /octave/);
  assert.match(assessPitch(midiFrequency(71.9), 60, 67).text, /octave/);
});
test('listening assistance preserves normal mix at zero and emphasizes either selected part', () => {
  assert.deepEqual(mixLevels(.45, .4, 'melody', 0), { melody: .45, harmony: .4 });
  const melody = mixLevels(.45, .4, 'melody', 1);
  const harmony = mixLevels(.45, .4, 'harmony', 1);
  assert.equal(melody.melody, .7);
  assert.ok(melody.harmony < .09);
  assert.equal(harmony.harmony, .7);
  assert.ok(harmony.melody < .1);
  assert.equal(mixLevels(.45, .4, 'melody', 0, false).melody, 0);
  assert.equal(mixLevels(.45, .4, 'melody', 1, false).melody, .7);
  assert.equal(mixLevels(.9, .4, 'melody', 1).melody, 1);
  assert.equal(mixLevels(1, .4, 'melody', 1).melody, 1);
});
test('YIN identifies voice-range sine waves and ignores silence', () => {
  for (const rate of [44100, 48000]) {
    for (const frequency of [82.407, 130.813, 261.626, 440, 783.991, 1479.978]) {
      const samples = Float32Array.from({ length: 4096 }, (_, index) => .2 * Math.sin(2 * Math.PI * frequency * index / rate));
      const result = detectPitch(samples, rate);
      assert.ok(Math.abs(1200 * Math.log2(result / frequency)) < 12, `${frequency} Hz at ${rate} detected as ${result}`);
    }
  }
  assert.equal(detectPitch(new Float32Array(4096), 48000), null);
});
test('WAV has exact mono duration, sample rate and clipped PCM values', async () => {
  const view = new DataView(await wavBlob(new Float32Array([-2, 0, 2]), 48000).arrayBuffer());
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(48, true), 32767);
});
test('capture worklet excludes count-in and trims sample-accurate boundaries', async () => {
  let Processor;
  const messages = [];
  const scope = {
    AudioWorkletProcessor: class { port = { postMessage: value => messages.push(value) }; },
    registerProcessor: (_, implementation) => { Processor = implementation; },
    currentFrame: 0, Float32Array
  };
  vm.runInNewContext(await readFile(new URL('../public/capture-worklet.js', import.meta.url), 'utf8'), scope);
  const processor = new Processor();
  const window = captureWindow(130 / 48000, 390 / 48000, 48000);
  processor.port.onmessage({ data: { type: 'arm', id: 8, ...window } });
  for (const frame of [0, 128, 256, 384, 512]) {
    scope.currentFrame = frame;
    processor.process([[Float32Array.from({ length: 128 }, (_, index) => frame + index)]]);
  }
  const chunks = messages.filter(message => message.type === 'chunk');
  assert.deepEqual(chunks.map(chunk => chunk.offset), [0, 126, 254]);
  const samples = chunks.flatMap(chunk => [...chunk.samples]);
  assert.equal(samples.length, 260);
  assert.equal(samples[0], 130);
  assert.equal(samples.at(-1), 389);
  assert.equal(messages.filter(message => message.type === 'done').length, 1);
  processor.port.onmessage({ data: { type: 'arm', id: 9, startFrame: 512, endFrame: 800 } });
  processor.port.onmessage({ data: { type: 'cancel' } });
  scope.currentFrame = 640;
  processor.process([[new Float32Array(128)]]);
  assert.equal(messages.filter(message => message.id === 9).length, 0);
});
