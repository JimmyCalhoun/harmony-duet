import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
const installFakeAudio = () => {
  const NativeContext = window.AudioContext;
  window.testAudio = { events: [], microphones: [], mix: [] };
  window.AudioContext = class extends NativeContext {
    createOscillator() {
      const oscillator = super.createOscillator();
      const start = oscillator.start.bind(oscillator);
      oscillator.start = (...args) => {
        testAudio.events.push({ type: 'synth', at: args[0], frequency: oscillator.frequency.value });
        return start(...args);
      };
      return oscillator;
    }
    createGain() {
      const gain = super.createGain();
      const connect = gain.connect.bind(gain);
      gain.connect = (destination, ...rest) => {
        if (destination instanceof DynamicsCompressorNode) testAudio.mix.push(gain);
        return connect(destination, ...rest);
      };
      return gain;
    }
    createBufferSource() {
      const source = super.createBufferSource();
      const nativeStart = source.start.bind(source);
      source.start = (...args) => {
        testAudio.events.push({ type: 'play-take', at: args[0], duration: source.buffer.duration });
        return nativeStart(...args);
      };
      return source;
    }
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new NativeContext();
    await context.resume();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 220;
    const gain = context.createGain();
    gain.gain.value = 0.15;
    const destination = context.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    testAudio.microphones.push({ context, oscillator, stream: destination.stream });
    return destination.stream;
  };
  const NativeWorklet = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends NativeWorklet {
    constructor(...args) {
      super(...args);
      const send = this.port.postMessage.bind(this.port);
      this.port.postMessage = (data, ...rest) => {
        if (data.type === 'arm') testAudio.events.push({ type: 'capture', ...data, rate: args[0].sampleRate });
        return send(data, ...rest);
      };
    }
  };
};
await page.addInitScript(installFakeAudio);

async function saved() {
  return page.evaluate(async () => {
    const request = indexedDB.open('harmony-duet', 1);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const takes = await new Promise((resolve, reject) => {
      const read = db.transaction('takes').objectStore('takes').getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    db.close();
    return takes.map(take => {
      const view = new DataView(take.audio);
      const rate = view.getUint32(24, true);
      const length = view.getUint32(40, true) / 2;
      let crossings = 0;
      let peak = 0;
      for (let i = 1; i < length; i++) {
        const current = view.getInt16(44 + 2 * i, true);
        const prior = view.getInt16(44 + 2 * (i - 1), true);
        if (current >= 0 && prior < 0) crossings++;
        peak = Math.max(peak, Math.abs(current) / 32768);
      }
      return { part: take.part, duration: length / rate, hz: crossings / (length / rate), peak, config: take.config };
    });
  });
}
async function record(part, during) {
  await page.locator(`[name=part][value=${part}]`).check();
  await page.locator('#record').click();
  if (during) {
    await page.waitForFunction(() => document.getElementById('transport-status').textContent.startsWith('Recording'));
    await page.waitForTimeout(300);
    await during();
  }
  await page.waitForFunction(() => document.getElementById('transport-status').textContent.startsWith('Take saved'), null, { timeout: 15000 });
  assert.equal(await page.locator('#notice').isVisible(), false, await page.locator('#notice').textContent());
}

try {
  await page.goto(process.env.APP_URL || 'http://localhost:4173');
  await page.waitForFunction(() => document.querySelectorAll('.note').length === 18);
  await page.locator('#bpm').fill('180');
  await page.locator('#bpm').dispatchEvent('change');
  await record('melody');
  let takes = await saved();
  assert.equal(takes.length, 1);
  assert.equal(takes[0].duration, 3);
  assert.ok(Math.abs(takes[0].hz - 220) < 2, 'Microphone-only capture must not contain the synthesized C-major guide');
  assert.equal(await page.locator('#detected-note').textContent(), 'A3', 'Live tuner must read synthetic microphone pitch');

  await page.locator('[name=part][value=harmony]').check();
  assert.match(await page.locator('#opposite-status').textContent(), /Matching melody/);
  await page.evaluate(() => { testAudio.microphones[0].oscillator.frequency.value = 330; });
  await page.locator('#assistance').fill('80');
  assert.match(await page.locator('#assistance-value').textContent(), /80%.*harmony/);
  assert.equal(await page.locator('#melody-volume').inputValue(), '45');
  assert.equal(await page.locator('#harmony-volume').inputValue(), '40');
  await record('harmony', async () => {
    const mix = await page.evaluate(() => testAudio.mix.map(node => node.gain.value));
    assert.ok(Math.abs(mix[0] - .162) < .01 && Math.abs(mix[1] - .64) < .01, `Assistance must audibly raise selected guide and duck the saved opposite line: ${JSON.stringify(mix)}`);
  });
  takes = await saved();
  const harmony = takes.find(take => take.part === 'harmony');
  assert.ok(Math.abs(harmony.hz - 330) < 2, 'Overdub must contain only the second microphone tone, not first take or synth');
  assert.equal(harmony.duration, 3);
  let events = await page.evaluate(() => testAudio.events);
  let captures = events.filter(event => event.type === 'arm');
  let playbacks = events.filter(event => event.type === 'play-take');
  assert.equal(playbacks.length, 1);
  assert.ok(Math.abs(captures[1].startFrame / captures[1].rate - playbacks[0].at) < 1 / captures[1].rate, 'Opposite take must start at the microphone capture boundary');

  await page.locator('#reset-assistance').click();
  assert.equal(await page.locator('#assistance').inputValue(), '0');
  await page.evaluate(() => { testAudio.microphones[0].oscillator.frequency.value = 440; });
  await record('melody', async () => {
    const mix = await page.evaluate(() => testAudio.mix.map(node => node.gain.value));
    assert.ok(Math.abs(mix[0] - .45) < .01 && Math.abs(mix[1] - .4) < .01, 'Zero assistance must restore exact baseline mix');
  });
  takes = await saved();
  assert.ok(Math.abs(takes.find(take => take.part === 'melody').hz - 440) < 2);
  events = await page.evaluate(() => testAudio.events);
  captures = events.filter(event => event.type === 'arm');
  playbacks = events.filter(event => event.type === 'play-take');
  assert.equal(playbacks.length, 2, 'Harmony-first opposite take must play while recording melody');
  assert.ok(Math.abs(captures[2].startFrame / captures[2].rate - playbacks[1].at) < 1 / captures[2].rate);

  await page.locator('#play-duet').click();
  await page.waitForFunction(() => document.getElementById('transport-status').textContent.startsWith('Exercise complete'), null, { timeout: 12000 });
  playbacks = await page.evaluate(() => testAudio.events.filter(event => event.type === 'play-take'));
  assert.equal(playbacks.length, 4);
  assert.equal(playbacks[2].at, playbacks[3].at, 'Duet takes must start together');

  await page.locator('#record').click();
  await page.locator('#stop').click();
  assert.match(await page.locator('#transport-status').textContent(), /discarded/);
  assert.ok(Math.abs((await saved()).find(take => take.part === 'melody').hz - 440) < 2, 'Cancelling replacement keeps saved take');

  await page.locator('#key').selectOption('2');
  assert.equal(await page.locator('#play-duet').isDisabled(), true);
  assert.equal(await page.locator('.mismatch').count(), 2);
  await page.locator('.take').first().getByRole('button', { name: 'Use these settings' }).click();
  assert.equal(await page.locator('#play-duet').isEnabled(), true);
  await page.locator('#mic').click();
  assert.equal(await page.evaluate(() => testAudio.microphones.every(mic => mic.stream.getTracks().every(track => track.readyState === 'ended'))), true);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('audio').length === 2);
  await page.locator('.take').first().getByRole('button', { name: 'Use these settings' }).click();
  assert.equal(await page.locator('#play-duet').isEnabled(), true, 'Reload must restore both saved takes');
  await page.locator('audio').first().evaluate(audio => audio.play());
  await page.waitForFunction(() => document.querySelector('audio').currentTime > 0.15);
  await page.locator('audio').first().evaluate(audio => audio.pause());
  await page.locator('#bpm').fill('0');
  await page.locator('#bpm').dispatchEvent('change');
  await page.locator('#practice').click();
  assert.match(await page.locator('#notice').textContent(), /40 and 180/);
  await page.locator('#bpm').fill('180');
  await page.locator('#bpm').dispatchEvent('change');

  await page.locator('#harmony-degree').selectOption('1-to-5');
  const displayedDegrees = id => page.locator(`#${id} .note`).evaluateAll(notes => notes.map(note => Number(note.firstChild.textContent)));
  assert.deepEqual(await displayedDegrees('melody-notes'), [1, 2, 3, 4, 5, 4, 3, 2, 1]);
  assert.deepEqual(await displayedDegrees('harmony-notes'), [1, 1, 1, 1, 5, 5, 5, 5, 5]);
  assert.equal(await page.locator('#play-duet').isDisabled(), true);
  assert.equal(await page.locator('.mismatch').count(), 2, 'Legacy constant-note takes must not play against switching harmony');
  await page.locator('.take').first().getByRole('button', { name: 'Use these settings' }).click();
  assert.equal(await page.locator('#harmony-degree').inputValue(), '1', 'Legacy take must restore its original constant harmony after tempo editing');
  assert.equal(await page.locator('#play-duet').isEnabled(), true);
  await page.locator('#harmony-degree').selectOption('5');
  assert.deepEqual(await displayedDegrees('harmony-notes'), Array(9).fill(5));
  await page.locator('#harmony-degree').selectOption('1-to-5');
  await page.locator('[name=part][value=harmony]').check();
  await page.locator('#mic').click();
  await page.waitForFunction(() => document.getElementById('mic-light').textContent === 'Mic on');
  await page.evaluate(() => {
    testAudio.events = [];
    testAudio.microphones[0].oscillator.frequency.value = 349.228;
  });
  await page.locator('#practice').click();
  await page.waitForFunction(() => document.getElementById('beat-status').textContent.includes('beat 4/9'));
  assert.equal(await page.locator('#your-target').textContent(), 'C4');
  await page.waitForFunction(() => document.getElementById('beat-status').textContent.includes('beat 6/9')
    && document.getElementById('pitch-card').classList.contains('drift'));
  assert.equal(await page.locator('#your-target').textContent(), 'G4');
  assert.equal(await page.locator('#other-target').textContent(), 'F4');
  await page.waitForFunction(() => document.getElementById('transport-status').textContent.startsWith('Exercise complete'));
  const synth = await page.evaluate(() => testAudio.events.filter(event => event.type === 'synth'));
  const expectedMelody = [60, 62, 64, 65, 67, 65, 64, 62, 60];
  const expectedHarmony = [60, 60, 60, 60, 67, 67, 67, 67, 67];
  assert.equal(synth.length, 22, 'Four count-in clicks plus nine notes on each line');
  for (let index = 0; index < 9; index++) {
    assert.ok(Math.abs(synth[4 + index].frequency - 440 * 2 ** ((expectedMelody[index] - 69) / 12)) < .01);
    assert.ok(Math.abs(synth[13 + index].frequency - 440 * 2 ** ((expectedHarmony[index] - 69) / 12)) < .01);
    assert.equal(synth[4 + index].at, synth[13 + index].at, 'Synth lines must align on every beat');
  }
  await record('harmony');
  assert.equal((await saved()).find(take => take.part === 'harmony').config.harmonyDegree, '1-to-5');
  assert.equal(await page.locator('#play-duet').isDisabled(), true, 'Mixed-pattern pair must remain incompatible');
  await page.locator('#assistance').fill('80');
  await record('melody', async () => {
    const mix = await page.evaluate(() => testAudio.mix.map(node => node.gain.value));
    assert.ok(mix[0] > .6 && mix[1] < .15, 'Assistance must also emphasize melody against a saved switching-harmony take');
  });
  await record('harmony');
  events = await page.evaluate(() => testAudio.events);
  captures = events.filter(event => event.type === 'arm');
  playbacks = events.filter(event => event.type === 'play-take');
  assert.equal(playbacks.length, 2, 'Switching pattern must overdub in both directions');
  for (let index = 0; index < 2; index++) {
    assert.ok(Math.abs(captures[index + 1].startFrame / captures[index + 1].rate - playbacks[index].at) < 1 / captures[index + 1].rate);
  }
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('audio').length === 2);
  assert.equal(await page.locator('#play-duet').isDisabled(), true);
  await page.locator('.take').first().getByRole('button', { name: 'Use these settings' }).click();
  assert.equal(await page.locator('#harmony-degree').inputValue(), '1-to-5', 'Saved pattern must survive reload and restore');
  assert.equal(await page.locator('#play-duet').isEnabled(), true);
  assert.deepEqual(await displayedDegrees('harmony-notes'), expectedHarmony.map(midi => midi === 60 ? 1 : 5));
  await page.locator('#play-duet').click();
  await page.waitForFunction(() => document.getElementById('transport-status').textContent.startsWith('Exercise complete'));
  await page.locator('#harmony-degree').selectOption('5');
  assert.equal(await page.locator('#play-duet').isDisabled(), true);
  await page.locator('.take').first().getByRole('button', { name: 'Use these settings' }).click();

  const intervalPatterns = [
    { id: 'third-above', label: 'Third above', degrees: ['3','4','5','6','7','6','5','4','3'], pitches: [64,65,67,69,71,69,67,65,64], target: 'E4' },
    { id: 'third-below', label: 'Third below', degrees: ['6↓','7↓','1','2','3','2','1','7↓','6↓'], pitches: [57,59,60,62,64,62,60,59,57], target: 'A3' },
    { id: 'sixth-above', label: 'Sixth above', degrees: ['6','7','1↑','2↑','3↑','2↑','1↑','7','6'], pitches: [69,71,72,74,76,74,72,71,69], target: 'A4' }
  ];
  for (const pattern of intervalPatterns) {
    await page.locator('#harmony-degree').selectOption(pattern.id);
    assert.equal(await page.locator('#play-duet').isDisabled(), true, 'Other exercise recordings must be incompatible');
    assert.deepEqual(await page.locator('#harmony-notes .note').evaluateAll(notes => notes.map(note => note.firstChild.textContent)), pattern.degrees);
    await page.locator('[name=part][value=harmony]').check();
    assert.equal(await page.locator('#your-target').textContent(), pattern.target);
    await page.locator('#use-take').uncheck();
    await page.evaluate(() => { testAudio.events = []; });
    await page.locator('#practice').click();
    await page.waitForFunction(() => document.getElementById('transport-status').textContent.startsWith('Exercise complete'));
    const scheduled = await page.evaluate(() => testAudio.events.filter(event => event.type === 'synth'));
    assert.equal(scheduled.length, 22);
    for (let index = 0; index < 9; index++) {
      assert.ok(Math.abs(scheduled[13 + index].frequency - 440 * 2 ** ((pattern.pitches[index] - 69) / 12)) < .01, `${pattern.id} scheduled harmony note ${index}`);
      assert.ok(Math.abs(scheduled[4 + index].frequency - 440 * 2 ** ((expectedMelody[index] - 69) / 12)) < .01);
      assert.equal(scheduled[4 + index].at, scheduled[13 + index].at);
    }
    await page.locator('#use-take').check();
    await record('melody');
    await page.evaluate(() => { testAudio.events = []; });
    await record('harmony');
    await record('melody');
    const recordingEvents = await page.evaluate(() => testAudio.events);
    const intervalCaptures = recordingEvents.filter(event => event.type === 'arm');
    const intervalPlayback = recordingEvents.filter(event => event.type === 'play-take');
    assert.equal(intervalCaptures.length, 2);
    assert.equal(intervalPlayback.length, 2, `${pattern.id} must support both overdub directions`);
    for (let index = 0; index < 2; index++) {
      assert.ok(Math.abs(intervalCaptures[index].startFrame / intervalCaptures[index].rate - intervalPlayback[index].at) < 1 / intervalCaptures[index].rate);
    }
    assert.ok((await saved()).every(take => take.config.harmonyDegree === pattern.id));
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('audio').length === 2);
    assert.equal(await page.locator('#play-duet').isDisabled(), true);
    await page.locator('.take').first().getByRole('button', { name: 'Use these settings' }).click();
    assert.equal(await page.locator('#harmony-degree').inputValue(), pattern.id);
    assert.equal(await page.locator('#play-duet').isEnabled(), true);
    assert.match(await page.locator('.take').first().textContent(), new RegExp(pattern.label));
  }

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile layout must not overflow');
  await page.screenshot({ path: process.env.SCREENSHOT_PATH || '/tmp/harmony-duet-mobile.png', fullPage: true });

  const failure = await browser.newPage();
  failure.on('pageerror', error => errors.push(error.message));
  await failure.addInitScript(installFakeAudio);
  await failure.goto(process.env.APP_URL || 'http://localhost:4173');
  await failure.waitForFunction(() => document.querySelectorAll('.note').length === 18);
  await failure.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test denial', 'NotAllowedError'); };
  });
  await failure.locator('#record').click();
  await failure.waitForFunction(() => document.getElementById('notice').textContent.includes('permission was denied'));
  assert.equal(await failure.locator('#record').isEnabled(), true);
  assert.equal(await failure.locator('#mic-light').textContent(), 'Mic off');
  await failure.reload();
  await failure.waitForFunction(() => document.querySelectorAll('.note').length === 18);
  await failure.evaluate(() => {
    const request = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (...args) => {
      testAudio.events.push({ type: 'pending-mic' });
      await new Promise(resolve => setTimeout(resolve, 600));
      return request(...args);
    };
  });
  await failure.locator('#record').click();
  await failure.waitForFunction(() => testAudio.events.some(event => event.type === 'pending-mic'));
  await failure.locator('#stop').click();
  await failure.waitForFunction(() => !document.getElementById('record').disabled);
  assert.equal(await failure.locator('#mic-light').textContent(), 'Mic off', 'Cancelling pending permission must release late-arriving microphone stream');
  assert.equal(await failure.evaluate(() => testAudio.microphones.every(mic => mic.stream.getTracks().every(track => track.readyState === 'ended'))), true);
  await failure.locator('#bpm').fill('180');
  await failure.locator('#bpm').dispatchEvent('change');
  await failure.evaluate(() => {
    IDBObjectStore.prototype.put = () => { throw new DOMException('Test quota exhausted', 'QuotaExceededError'); };
  });
  await failure.locator('#record').click();
  await failure.waitForFunction(() => document.getElementById('transport-status').textContent.startsWith('Take ready'), null, { timeout: 15000 });
  assert.match(await failure.locator('#notice').textContent(), /could not be saved.*quota/i);
  assert.equal(await failure.locator('audio').count(), 1, 'Storage failure must retain a playable/downloadable take for the visit');
  assert.equal(await failure.locator('#record').isEnabled(), true, 'Storage failure must not leave the interface busy');
  await failure.close();
  assert.deepEqual(errors, []);
  console.log('PASS: original/switching/third-above/third-below/sixth-above patterns, exact synth pitches and octave labels, both overdub directions per new pattern, changing pitch/drift targets, pattern compatibility/legacy restore/persistence, frame-aligned playback, microphone-only WAVs, assistance gains/reset, cancellation, invalid settings, solo/duet playback, mic cleanup, denied permission, pending-request cancellation, storage failure and mobile layout.');
} finally {
  await browser.close();
}
