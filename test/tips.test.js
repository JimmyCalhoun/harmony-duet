import assert from 'node:assert/strict';
import test from 'node:test';
import { createTipProgress } from '../public/tips.js';

function store() {
  const values = new Map();
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}
const noError = error => { throw error; };

test('tips follow the approved order and wait for available duet playback', () => {
  const progress = createTipProgress(store, noError);
  for (const id of ['microphone', 'line', 'pitch', 'record']) {
    assert.equal(progress.current(false).id, id);
    progress.dismiss(id);
  }
  assert.equal(progress.current(false), null);
  assert.equal(progress.current(true).id, 'duet');
  assert.equal(progress.current(false), null);
  progress.dismiss('duet');
  assert.equal(progress.current(true), null);
});

test('versioned per-tip dismissals survive reload; unfinished tips remain eligible', () => {
  const storage = store();
  let progress = createTipProgress(() => storage, noError);
  progress.dismiss('microphone');
  assert.equal(storage.getItem('harmony-duet.tips.v1.microphone'), 'dismissed');
  assert.equal(storage.getItem('harmony-duet.tips.v1.line'), null);
  progress = createTipProgress(() => storage, noError);
  assert.equal(progress.current(false).id, 'line');
  storage.setItem('harmony-duet.tips.v0.pitch', 'dismissed');
  progress.dismiss('line');
  assert.equal(progress.current(false).id, 'pitch');
});

test('skip includes conditional tips; reset restores all tips without clearing other data', () => {
  const storage = store();
  storage.setItem('unrelated', 'keep');
  const progress = createTipProgress(() => storage, noError);
  progress.skip();
  assert.equal(createTipProgress(() => storage, noError).current(true), null);
  progress.reset();
  assert.equal(createTipProgress(() => storage, noError).current(false).id, 'microphone');
  assert.equal(storage.getItem('unrelated'), 'keep');
});

test('unavailable storage reports errors and keeps progression, skip and reset usable', () => {
  const errors = [];
  const progress = createTipProgress(() => { throw new Error('Storage blocked'); }, error => errors.push(error.message));
  progress.dismiss('microphone');
  assert.equal(progress.current(false).id, 'line');
  progress.skip();
  assert.equal(progress.current(true), null);
  progress.reset();
  assert.equal(progress.current(false).id, 'microphone');
  assert.ok(errors.length > 0);
  assert.ok(errors.every(message => message === 'Storage blocked'));
});

test('write failures are explicit and do not prevent in-memory dismissal', () => {
  const errors = [];
  const storage = store();
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  const progress = createTipProgress(() => storage, error => errors.push(error.message));
  progress.dismiss('microphone');
  assert.equal(progress.current(false).id, 'line');
  assert.deepEqual(errors, ['Quota exceeded']);
  assert.throws(() => progress.dismiss('unknown'), /Unknown teaching tip/);
});
