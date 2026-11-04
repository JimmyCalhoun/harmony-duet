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
  assert.match(await page.locator('#assistance-value').textContent(), /80%.*steady harmony/);
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
  console.log('PASS: both overdub directions, frame-aligned playback, microphone-only WAVs, live pitch, actual assistance gains/reset, cancellation, incompatible/invalid settings, reload persistence, solo/duet playback, mic cleanup, denied permission, pending-request cancellation, storage failure and mobile layout.');
} finally {
  await browser.close();
}
