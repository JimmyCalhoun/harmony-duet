import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required']
});
const url = process.env.APP_URL || 'http://localhost:4173';
const errors = [];
async function open(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('.note').length === 18);
  return page;
}
async function current(page, id) {
  await page.waitForFunction(id => document.querySelector('.teaching-bubble')?.dataset.tip === id, id);
  assert.equal(await page.locator('.teaching-bubble').count(), 1);
}
async function unobstructed(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => {
    const bubble = document.querySelector('.teaching-bubble');
    return bubble && !bubble.hidden;
  });
  assert.equal(await page.evaluate(() => {
    const element = document.querySelector('.teaching-bubble');
    const bubble = element.getBoundingClientRect();
    const extra = element.dataset.tip === 'line' ? '.parts,.score,.assistance'
      : element.dataset.tip === 'pitch' ? '.target-grid,#pitch-history'
      : element.dataset.tip === 'record' ? '.parts'
      : element.dataset.tip === 'microphone' ? '.monitoring' : '';
    const inputs = element.dataset.tip === 'microphone' ? ',input,select' : '';
    const overlaps = [...document.querySelectorAll(`button,audio${inputs}${extra ? ',' + extra : ''}`)]
      .filter(element => !element.closest('.teaching-bubble'))
      .some(element => {
        const box = element.getBoundingClientRect();
        return box.width && box.height && box.left < bubble.right && box.right > bubble.left &&
          box.top < bubble.bottom && box.bottom > bubble.top;
      });
    return !overlaps && getComputedStyle(element).position === 'fixed' && element.parentElement === document.body &&
      bubble.left >= 12 && bubble.top >= 12 && bubble.right <= innerWidth - 12 && bubble.bottom <= innerHeight - 12 &&
      document.documentElement.scrollWidth <= innerWidth;
  }), true, 'Coachmark must float within viewport, outside document flow and clear of interactive/explained controls');
}
async function responsive(page) {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 600 }, { width: 320, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => document.querySelector('.teaching-target').scrollIntoView({ block: 'center', behavior: 'instant' }));
    await unobstructed(page);
    assert.equal(await page.locator('.teaching-bubble').evaluate(element =>
      getComputedStyle(element, '::before').content === '""' && ['above', 'below', 'left', 'right'].includes(element.dataset.side)
    ), true, 'Coachmark must include a directional pointer');
  }
}

try {
  const context = await browser.newContext();
  const page = await open(context);
  await current(page, 'microphone');
  assert.match(await page.locator('.teaching-bubble').textContent(), /monitoring is off by default.*Hear myself.*headphones/);
  assert.equal(await page.locator('#monitor').isChecked(), false);
  assert.equal(await page.locator('#monitor').isDisabled(), true);
  await unobstructed(page);
  assert.ok((await page.locator('.teaching-bubble').boundingBox()).height >= 180,
    'The first coachmark should remain prominent alongside the monitoring panel');
  assert.equal(await page.locator('#mic-light').textContent(), 'Mic off');
  assert.equal(await page.locator('#practice').isEnabled(), true);
  for (const width of [1280, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#mic').scrollIntoViewIfNeeded();
    await unobstructed(page);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => document.querySelector('.teaching-bubble').hidden);
  assert.equal(await page.locator('.teaching-bubble').getAttribute('data-tip'), 'microphone', 'Scrolling away must not dismiss the tip');
  await page.locator('#mic').scrollIntoViewIfNeeded();
  await unobstructed(page);
  await page.getByRole('button', { name: 'Next tip', exact: true }).focus();
  await page.keyboard.press('Enter');
  await current(page, 'line');
  assert.equal(await page.getByRole('button', { name: 'Next tip', exact: true }).evaluate(button => button === document.activeElement), true);
  await page.reload();
  await current(page, 'line');
  await responsive(page);
  const layout = await page.locator('.practice').boundingBox();
  await page.getByRole('button', { name: 'Dismiss this tip', exact: true }).click();
  await current(page, 'pitch');
  await responsive(page);
  assert.equal((await page.locator('.practice').boundingBox()).height, layout.height, 'Changing coachmarks must not change document layout');
  await page.getByRole('button', { name: 'Show tips again', exact: true }).click();
  await page.getByRole('button', { name: 'Next tip', exact: true }).click();
  await current(page, 'line');
  await page.locator('[name=part][value=harmony]').check();
  assert.equal(await page.locator('#record').textContent(), '● Record my harmony');
  await unobstructed(page);
  await page.getByRole('button', { name: 'Next tip', exact: true }).click();
  await current(page, 'pitch');
  await unobstructed(page);
  await page.getByRole('button', { name: 'Next tip', exact: true }).click();
  await current(page, 'record');
  await responsive(page);
  await unobstructed(page);
  await page.getByRole('button', { name: 'Next tip', exact: true }).click();
  assert.equal(await page.locator('.teaching-bubble').count(), 0);
  assert.equal(await page.locator('#play-duet').isDisabled(), true);
  await page.reload();
  assert.equal(await page.locator('.teaching-bubble').count(), 0);

  await page.evaluate(async () => {
    const { signature, wavBlob } = await import(new URL('./music.js', location.href));
    const { saveTake } = await import(new URL('./storage.js', location.href));
    const config = { key: 0, octave: 4, bpm: 90, harmonyDegree: 1, repeats: 1 };
    for (const part of ['melody', 'harmony']) {
      await saveTake({
        part, config, signature: signature(config), createdAt: new Date().toISOString(),
        duration: 6, blob: wavBlob(new Float32Array(48000 * 6), 48000)
      });
    }
  });
  await page.reload();
  await current(page, 'duet');
  assert.equal(await page.locator('#play-duet').isEnabled(), true);
  await page.locator('#play-duet').scrollIntoViewIfNeeded();
  await responsive(page);
  await unobstructed(page);
  await page.locator('#bpm').fill('100');
  assert.equal(await page.locator('.teaching-bubble').count(), 0, 'Incompatible takes must hide the final tip');
  await page.locator('#bpm').fill('90');
  await current(page, 'duet');
  await page.locator('#practice').click();
  await page.waitForFunction(() => document.getElementById('play-duet').disabled);
  assert.equal(await page.locator('.teaching-bubble').count(), 0, 'Busy playback must not teach a disabled action');
  await page.locator('#stop').click();
  await current(page, 'duet');
  await page.locator('#play-duet').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.reload();
  assert.equal(await page.locator('.teaching-bubble').count(), 0);
  await page.getByRole('button', { name: 'Show tips again', exact: true }).click();
  await current(page, 'microphone');
  assert.equal(await page.locator('#play-duet').isEnabled(), true, 'Reset must preserve recordings');
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
  await page.reload();
  assert.equal(await page.locator('.teaching-bubble').count(), 0);
  await context.close();

  for (const blocked of ['access', 'write']) {
    const context = await browser.newContext();
    await context.addInitScript(mode => {
      if (mode === 'access') {
        Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
      } else {
        Storage.prototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
      }
    }, blocked);
    const page = await open(context);
    await current(page, 'microphone');
    await page.getByRole('button', { name: 'Next tip', exact: true }).click();
    await current(page, 'line');
    assert.match(await page.locator('#tips-status').textContent(), /could not be saved or read.*this visit only/);
    assert.equal(await page.locator('#practice').isEnabled(), true);
    await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
    assert.equal(await page.locator('.teaching-bubble').count(), 0);
    await page.getByRole('button', { name: 'Show tips again', exact: true }).click();
    await current(page, 'microphone');
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: floating coachmarks and pointers, stable document layout, scroll/resize repositioning, unobstructed desktop/mobile controls, tip order, keyboard progression, reload persistence, skip/reset, compatible and enabled duet gating, storage errors and recording preservation.');
} finally {
  await browser.close();
}
