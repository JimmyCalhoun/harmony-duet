import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { DEGREES, degreeMidi, degreeLabel, noteName, midiFrequency, harmonyDegrees, makeTimeline, targetAt, signature, assessPitch, mixLevels, captureWindow, wavBlob } from '../public/music.js';
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
test('switching harmony aligns four tonic and five dominant notes to the unchanged melody each round', () => {
  const c = { ...config, harmonyDegree: '1-to-5', repeats: 2, bpm: 120 };
  assert.deepEqual(harmonyDegrees(c), [1, 1, 1, 1, 5, 5, 5, 5, 5]);
  const timeline = makeTimeline(c, 10);
  for (let round = 0; round < 2; round++) {
    const notes = timeline.notes.slice(round * 9, (round + 1) * 9);
    assert.deepEqual(notes.map(note => note.melody), [60, 62, 64, 65, 67, 65, 64, 62, 60]);
    assert.deepEqual(notes.map(note => note.harmony), [60, 60, 60, 60, 67, 67, 67, 67, 67]);
    for (const [index, note] of notes.entries()) {
      assert.equal(note.start, 10 + (round * 9 + index) * .5);
      assert.equal(note.end, note.start + .5);
      assert.equal(targetAt(timeline, note.start + .1), note);
    }
  }
  assert.equal(assessPitch(midiFrequency(65), timeline.notes[5].harmony, timeline.notes[5].melody).kind, 'drift');
  assert.equal(assessPitch(midiFrequency(67), timeline.notes[4].harmony, timeline.notes[4].melody).kind, 'good');
  const transposed = makeTimeline({ ...c, key: 2, octave: 3 });
  assert.deepEqual(transposed.notes.slice(0, 9).map(note => note.harmony), [50, 50, 50, 50, 57, 57, 57, 57, 57]);
});
test('pattern signatures distinguish all three choices and preserve legacy recording compatibility', () => {
  assert.equal(signature(config), '[0,4,90,1,1]');
  assert.equal(signature({ ...config, harmonyDegree: 5 }), '[0,4,90,5,1]');
  const variant = { ...config, harmonyDegree: '1-to-5' };
  assert.notEqual(signature(variant), signature(config));
  assert.notEqual(signature(variant), signature({ ...config, harmonyDegree: 5 }));
  assert.equal(signature(JSON.parse(JSON.stringify(variant))), signature(variant));
  for (const degree of [1, 5]) {
    assert.deepEqual(harmonyDegrees({ ...config, harmonyDegree: degree }), Array(9).fill(degree));
  }
});
test('feedback detects the other line and does not warn where parts meet', () => {
  assert.equal(assessPitch(midiFrequency(60), 64, 60).kind, 'drift');
  assert.equal(assessPitch(midiFrequency(60), 60, 60).kind, 'good');
  assert.equal(assessPitch(midiFrequency(64), 60, 64).kind, 'drift');
  assert.match(assessPitch(midiFrequency(72), 60, 67).text, /octave/);
  assert.match(assessPitch(midiFrequency(71.9), 60, 67).text, /octave/);
});
const intervals = [
  ['third-above', [3,4,5,6,7,6,5,4,3], [64,65,67,69,71,69,67,65,64], ['3','4','5','6','7','6','5','4','3']],
  ['third-below', [-1,0,1,2,3,2,1,0,-1], [57,59,60,62,64,62,60,59,57], ['6↓','7↓','1','2','3','2','1','7↓','6↓']],
  ['sixth-above', [6,7,8,9,10,9,8,7,6], [69,71,72,74,76,74,72,71,69], ['6','7','1↑','2↑','3↑','2↑','1↑','7','6']]
];
for (const [pattern, degrees, pitches, labels] of intervals) {
  test(`${pattern} maps diatonic intervals, octave labels, transposition and repeated timeline`, () => {
    const c = { ...config, harmonyDegree: pattern, repeats: 2 };
    assert.deepEqual(harmonyDegrees(c), degrees);
    assert.deepEqual(degrees.map(degreeLabel), labels);
    const timeline = makeTimeline(c, 4);
    assert.deepEqual(timeline.notes.map(note => note.harmony), [...pitches, ...pitches]);
    assert.deepEqual(timeline.notes.slice(0, 9).map(note => note.melody), [60,62,64,65,67,65,64,62,60]);
    for (const [index, note] of timeline.notes.entries()) {
      assert.ok(Math.abs(note.start - (4 + index * 60 / 90)) < 1e-12);
      assert.equal(targetAt(timeline, note.start + .01), note);
      assert.equal(assessPitch(midiFrequency(note.melody), note.harmony, note.melody).kind, 'drift');
    }
    for (const key of [0,2,6,11]) {
      for (const octave of [3,4,5]) {
        assert.deepEqual(makeTimeline({ ...c, key, octave }).notes.slice(0,9).map(note => note.harmony),
          pitches.map(pitch => pitch + key + 12 * (octave - 4)));
      }
    }
    assert.equal(signature(JSON.parse(JSON.stringify(c))), signature(c));
  });
}
test('all six pattern identities are incompatible with one another; unsupported choices fail explicitly', () => {
  const choices = [1, 5, '1-to-5', ...intervals.map(([pattern]) => pattern)];
  assert.equal(new Set(choices.map(harmonyDegree => signature({ ...config, harmonyDegree }))).size, 6);
  assert.throws(() => harmonyDegrees({ ...config, harmonyDegree: 'unsupported' }), /supported harmony/);
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
    for (const frequency of [82.407, 110, 130.813, 261.626, 440, 783.991, 1479.978, 2489.016]) {
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
