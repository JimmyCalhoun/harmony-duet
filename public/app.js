import { DEGREES, KEYS, HARMONY_PATTERNS, otherPart, midiFrequency, frequencyMidi, noteName, degreeMidi, degreeLabel, harmonyDegrees, signature, makeTimeline, targetAt, assessPitch, mixLevels, captureWindow, wavBlob } from './music.js';
import { detectPitch } from './pitch.js';
import { openStore, saveTake, deleteTake } from './storage.js';

const $ = id => document.getElementById(id);
const partNames = { melody: 'melody', harmony: 'harmony' };
const takes = new Map();
const urls = new Map();
let active = null;
let starting = false;
let saving = false;
let sequence = 0;
let history = [];
let lastPitchTime = 0;
let lastFeedback = '';
let storageReady = false;

function config() {
  const bpm = Number($('bpm').value);
  if (!Number.isInteger(bpm) || bpm < 40 || bpm > 180) throw new Error('Choose a whole-number tempo between 40 and 180 BPM.');
  return {
    key: Number($('key').value), octave: Number($('octave').value), bpm,
    harmonyDegree: ['1', '5'].includes($('harmony-degree').value) ? Number($('harmony-degree').value) : $('harmony-degree').value,
    repeats: Number($('repeats').value)
  };
}
const selectedPart = () => document.querySelector('[name=part]:checked').value;
const compatible = take => Boolean(take && $('bpm').validity.valid && take.signature === signature(config()));
function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}
function describe(c) {
  const harmony = HARMONY_PATTERNS[c.harmonyDegree]?.label || `repeated ${c.harmonyDegree}`;
  return `${noteName(degreeMidi(c, 1))} major · ${c.bpm} BPM · harmony ${harmony} · ${c.repeats} ${c.repeats === 1 ? 'round' : 'rounds'}`;
}

class AudioEngine {
  context = null;
  stream = null;
  source = null;
  analyser = null;
  capture = null;
  silent = null;
  nodes = new Set();
  channels = {};
  async ready() {
    if (!window.AudioContext) throw new Error('Web Audio is not supported. Try a current Chrome, Edge, Firefox, or Safari browser.');
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;
      const master = this.context.createGain();
      master.gain.value = 0.65;
      compressor.connect(master).connect(this.context.destination);
      for (const part of ['melody', 'harmony', 'count']) {
        this.channels[part] = this.context.createGain();
        this.channels[part].connect(compressor);
      }
      this.channels.count.gain.value = 0.25;
      this.context.onstatechange = () => {
        if (this.context.state !== 'running' && active) {
          stop('Audio was interrupted. The unfinished take was discarded; press Practice or Record to restart.');
        }
      };
    }
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Audio could not start. Tap the button again, or check your browser audio permissions.');
    this.updateMix();
  }
  async enableMic() {
    if (this.stream?.active) return;
    await this.ready();
    if (!navigator.mediaDevices?.getUserMedia || !this.context.audioWorklet) {
      throw new Error('Microphone recording needs a current browser on localhost or HTTPS.');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1
      } });
      if (!this.workletReady) {
        await this.context.audioWorklet.addModule('./capture-worklet.js');
        this.workletReady = true;
      }
      this.stream = stream;
      this.source = this.context.createMediaStreamSource(stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 4096;
      this.pitchBuffer = new Float32Array(this.analyser.fftSize);
      this.capture = new AudioWorkletNode(this.context, 'microphone-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.capture.port.onmessage = event => captureMessage(event.data);
      this.capture.onprocessorerror = () => {
        stop('The microphone recorder stopped unexpectedly. The unfinished take was discarded.');
        this.releaseMic();
      };
      this.silent = this.context.createGain();
      this.silent.gain.value = 0;
      this.source.connect(this.analyser);
      this.source.connect(this.capture).connect(this.silent).connect(this.context.destination);
      stream.getAudioTracks().forEach(track => {
        track.onended = () => {
          stop('Microphone access ended. Re-enable the microphone to continue.');
          this.releaseMic();
        };
        track.onmute = () => {
          if (active?.mode === 'record') stop('The microphone was muted by the device. The unfinished take was discarded.');
          $('mic-status').textContent = 'Microphone input is muted by the device or browser.';
        };
        track.onunmute = () => { $('mic-status').textContent = 'Listening for pitch only. No live microphone monitoring.'; };
      });
      $('mic').textContent = 'Disconnect microphone';
      $('mic-status').textContent = 'Listening for pitch only. No live microphone monitoring.';
      $('mic-light').textContent = 'Mic on';
      $('mic-light').classList.add('on');
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      this.releaseMic();
      const messages = {
        NotAllowedError: 'Microphone permission was denied. Allow microphone access in browser site settings, then try again.',
        NotFoundError: 'No microphone was found. Connect a microphone and try again.',
        NotReadableError: 'The microphone is busy or unavailable. Check your device and other apps.',
        SecurityError: 'Microphone access is blocked. Open this app on localhost or HTTPS.'
      };
      throw new Error(messages[error.name] || `Microphone could not start: ${error.message}`);
    }
  }
  releaseMic() {
    this.stream?.getTracks().forEach(track => {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      track.stop();
    });
    for (const node of [this.source, this.analyser, this.capture, this.silent]) node?.disconnect();
    this.stream = this.source = this.analyser = this.capture = this.silent = null;
    $('mic').textContent = 'Enable microphone';
    $('mic-status').textContent = 'Microphone disconnected. Enable it when you are ready.';
    $('mic-light').textContent = 'Mic off';
    $('mic-light').classList.remove('on');
    resetPitch('Enable your mic to see live feedback.');
  }
  updateMix() {
    const levels = mixLevels(Number($('melody-volume').value) / 100, Number($('harmony-volume').value) / 100,
      selectedPart(), Number($('assistance').value) / 100, active?.mode === 'duet' || $('guide').checked);
    if (this.context) {
      for (const part of ['melody', 'harmony']) this.channels[part].gain.setTargetAtTime(levels[part], this.context.currentTime, 0.025);
    }
    for (const part of ['melody', 'harmony']) $(`${part}-volume-value`).textContent = `${$(part + '-volume').value}%`;
    const amount = Number($('assistance').value);
    $('assistance-value').textContent = amount ? `${amount}% · ${partNames[selectedPart()]} forward` : 'Off · normal mix';
    $('assist-note').textContent = amount && !$('guide').checked && active?.mode !== 'duet'
      ? 'Assistance adds your synth guide. Mic recording is unchanged.'
      : 'Your baseline volumes stay unchanged.';
  }
  track(node) {
    this.nodes.add(node);
    node.onended = () => { node.disconnect(); this.nodes.delete(node); };
    return node;
  }
  tone(midi, start, duration, part, click = false) {
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = click ? 'sine' : 'triangle';
    oscillator.frequency.value = midiFrequency(midi);
    const finish = start + duration;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(click ? 0.6 : 0.42, start + 0.012);
    envelope.gain.setValueAtTime(click ? 0.6 : 0.42, Math.max(start + 0.012, finish - 0.025));
    envelope.gain.linearRampToValueAtTime(0, finish);
    oscillator.connect(envelope).connect(this.channels[part]);
    this.track(oscillator);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); this.nodes.delete(oscillator); };
    oscillator.start(start);
    oscillator.stop(finish);
  }
  async decode(take) { return this.context.decodeAudioData(await take.blob.arrayBuffer()); }
  playBuffer(buffer, start, part) {
    const node = this.track(this.context.createBufferSource());
    node.buffer = buffer;
    node.connect(this.channels[part]);
    node.start(start);
  }
  stop() {
    this.capture?.port.postMessage({ type: 'cancel' });
    for (const node of this.nodes) {
      node.stop();
      node.disconnect();
    }
    this.nodes.clear();
  }
}
const engine = new AudioEngine();

function updateControls() {
  const busy = Boolean(active || starting || saving);
  document.querySelectorAll('.exercise-setting,[name=part],#use-take').forEach(element => { element.disabled = busy; });
  $('practice').disabled = busy;
  $('record').disabled = busy;
  $('stop').disabled = !active && !starting;
  $('mic').disabled = starting || saving;
  $('play-duet').disabled = busy || !compatible(takes.get('melody')) || !compatible(takes.get('harmony'));
  document.querySelectorAll('.take button').forEach(button => { button.disabled = busy; });
  document.querySelectorAll('.take audio').forEach(audio => {
    audio.controls = !busy;
    if (busy) audio.pause();
  });
}

function renderExercise() {
  try {
    const c = config();
    $('bpm').setCustomValidity('');
    const harmony = harmonyDegrees(c);
    for (const part of ['melody', 'harmony']) {
      $(part + '-notes').replaceChildren(...DEGREES.map((degree, index) => {
        const note = document.createElement('div');
        note.className = 'note';
        note.dataset.index = index;
        const value = part === 'melody' ? degree : harmony[index];
        note.append(degreeLabel(value));
        const octave = Math.floor((value - 1) / 7);
        note.setAttribute('aria-label', `Degree ${((value - 1) % 7 + 7) % 7 + 1}${octave < 0 ? ', lower octave' : octave > 0 ? ', upper octave' : ''}, ${noteName(degreeMidi(c, value))}`);
        const name = document.createElement('small');
        name.textContent = noteName(degreeMidi(c, value));
        note.append(name);
        return note;
      }));
    }
    const pattern = HARMONY_PATTERNS[c.harmonyDegree];
    $('harmony-tag').textContent = pattern?.tag || `${c.harmonyDegree} · ${c.harmonyDegree} · ${c.harmonyDegree}`;
    $('harmony-description').textContent = pattern?.description || 'Stay grounded while the melody moves';
    $('exercise-length').textContent = `${(9 * c.repeats * 60 / c.bpm).toFixed(1)} seconds + count-in`;
    $('record').textContent = `● Record my ${partNames[selectedPart()]}`;
    const opposite = takes.get(otherPart(selectedPart()));
    $('opposite-status').textContent = !$('use-take').checked
      ? 'Saved take bypassed — using the synthesized opposite line.'
      : compatible(opposite)
      ? `Matching ${partNames[opposite.part]} take ready. It replaces that synthesized line.`
      : opposite ? 'Saved take does not match these settings — using the synthesized line.' : 'No matching take yet — using the synthesized line.';
    history = [];
    showTargets(makeTimeline(c).notes[0]);
    renderTakes();
    engine.updateMix();
  } catch (error) {
    $('bpm').setCustomValidity(error.message);
    notice(error.message);
  }
}

function renderTakes() {
  const container = $('takes');
  container.replaceChildren();
  for (const part of ['melody', 'harmony']) {
    const take = takes.get(part);
    const card = document.createElement('article');
    card.className = 'take';
    const title = document.createElement('h3');
    title.textContent = part === 'melody' ? 'Your melody' : 'Your harmony';
    card.append(title);
    if (!take) {
      const empty = document.createElement('p');
      empty.textContent = 'A little room for your voice. Choose this part above and record your first take.';
      card.append(empty);
    } else {
      const info = document.createElement('p');
      info.textContent = `${describe(take.config)} · ${take.duration.toFixed(1)}s · ${new Date(take.createdAt).toLocaleString()}`;
      card.append(info);
      if (!compatible(take)) {
        const warning = document.createElement('p');
        warning.className = 'mismatch';
        warning.textContent = 'Different exercise settings. Solo playback is available, but this take will not be used for overdubbing or duet playback.';
        card.append(warning);
      }
      if (!urls.has(part)) urls.set(part, URL.createObjectURL(take.blob));
      const player = document.createElement('audio');
      player.controls = true;
      player.preload = 'metadata';
      player.src = urls.get(part);
      player.setAttribute('aria-label', `Play saved ${partNames[part]} recording`);
      player.onplay = () => {
        if (active || starting || saving) { player.pause(); return; }
        container.querySelectorAll('audio').forEach(audio => { if (audio !== player) audio.pause(); });
      };
      card.append(player);
      const actions = document.createElement('div');
      actions.className = 'take-actions';
      const download = document.createElement('a');
      download.href = urls.get(part);
      download.download = `harmony-duet-${part}-${take.createdAt.replaceAll(':', '-')}.wav`;
      download.textContent = 'Download WAV';
      const restore = document.createElement('button');
      restore.className = 'text-button';
      restore.textContent = 'Use these settings';
      restore.onclick = () => {
        $('key').value = take.config.key;
        $('octave').value = take.config.octave;
        $('bpm').value = take.config.bpm;
        $('harmony-degree').value = take.config.harmonyDegree;
        $('repeats').value = take.config.repeats;
        notice('');
        renderExercise();
      };
      const remove = document.createElement('button');
      remove.className = 'text-button';
      remove.textContent = 'Delete take';
      remove.onclick = async () => {
        if (!confirm(`Delete your saved ${partNames[part]} take? Download a backup first if you want to keep it.`)) return;
        try {
          if (storageReady) await deleteTake(part);
          URL.revokeObjectURL(urls.get(part));
          urls.delete(part);
          takes.delete(part);
          renderExercise();
        } catch (error) { notice(`Could not delete the take: ${error.message}`); }
      };
      actions.append(download, restore, remove);
      card.append(actions);
    }
    container.append(card);
  }
  updateControls();
}

async function start(mode) {
  if (active || starting || saving) return;
  const token = ++sequence;
  starting = true;
  notice('');
  $('transport-status').textContent = mode === 'record' ? 'Preparing microphone recording…' : 'Preparing audio…';
  $('progress').style.width = '0%';
  $('beat-status').textContent = '';
  updateControls();
  try {
    const c = config();
    const part = selectedPart();
    await engine.ready();
    if (token !== sequence) return;
    if (mode === 'record') {
      if (takes.has(part) && !confirm(`Replace your saved ${partNames[part]} take? The old take is kept unless the new recording finishes.`)) {
        $('transport-status').textContent = 'Replacement cancelled · saved take unchanged';
        return;
      }
      const hadMicrophone = Boolean(engine.stream);
      await engine.enableMic();
      if (token !== sequence && !hadMicrophone) engine.releaseMic();
    }
    if (token !== sequence) return;
    const buffers = {};
    if (mode === 'duet') {
      for (const role of ['melody', 'harmony']) {
        if (!compatible(takes.get(role))) throw new Error('Both takes must match the current exercise settings.');
        buffers[role] = await engine.decode(takes.get(role));
      }
    } else {
      const opposite = otherPart(part);
      if ($('use-take').checked && compatible(takes.get(opposite))) buffers[opposite] = await engine.decode(takes.get(opposite));
    }
    if (token !== sequence) return;
    const countStart = engine.context.currentTime + 0.2;
    const timeline = makeTimeline(c, countStart + 4 * 60 / c.bpm);
    active = { id: token, mode, part, config: c, timeline, countStart, usedTake: Object.keys(buffers) };
    if (mode === 'record') {
      const window = captureWindow(timeline.start, timeline.end, engine.context.sampleRate);
      active.samples = new Float32Array(window.endFrame - window.startFrame);
      active.captured = 0;
      engine.capture.port.postMessage({ type: 'arm', id: token, ...window });
    }
    for (let beat = 0; beat < 4; beat++) engine.tone(beat === 0 ? 84 : 79, countStart + beat * timeline.beat, 0.06, 'count', true);
    for (const role of ['melody', 'harmony']) {
      if (buffers[role]) engine.playBuffer(buffers[role], timeline.start, role);
      else if (mode !== 'duet') for (const note of timeline.notes) engine.tone(note[role], note.start, timeline.beat * 0.93, role);
    }
    history = [];
    engine.updateMix();
  } catch (error) {
    engine.stop();
    active = null;
    $('transport-status').textContent = 'Could not start · check the message below';
    notice(error.message);
  } finally {
    starting = false;
    if (token !== sequence) $('transport-status').textContent = 'Start cancelled · no recording saved';
    updateControls();
  }
}

function stop(message = '') {
  sequence++;
  const recording = active?.mode === 'record';
  const wasStarting = starting;
  engine.stop();
  active = null;
  $('transport-status').textContent = recording ? 'Stopped · unfinished take discarded' : wasStarting ? 'Start cancelled · waiting for the pending request to close' : 'Stopped';
  $('beat-status').textContent = '';
  document.querySelectorAll('.note.active').forEach(note => note.classList.remove('active'));
  updateControls();
  engine.updateMix();
  if (message) notice(message);
}

async function captureMessage(data) {
  const run = active;
  if (!run || run.mode !== 'record' || run.id !== data.id) return;
  if (data.type === 'chunk') {
    run.samples.set(data.samples, data.offset);
    run.captured += data.samples.length;
    return;
  }
  if (data.type !== 'done') return;
  if (run.captured !== run.samples.length) {
    stop('Microphone audio had missing samples. This take was discarded; reconnect your mic and try again.');
    return;
  }
  active = null;
  engine.stop();
  saving = true;
  $('transport-status').textContent = 'Saving microphone-only take…';
  updateControls();
  const peak = run.samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
  const take = {
    part: run.part, config: run.config, signature: signature(run.config),
    createdAt: new Date().toISOString(), duration: run.samples.length / engine.context.sampleRate,
    blob: wavBlob(run.samples, engine.context.sampleRate)
  };
  let persisted = false;
  const warnings = [];
  try {
    await saveTake(take);
    persisted = true;
    storageReady = true;
  } catch (error) {
    warnings.push(`The take is available for this visit, but could not be saved in this browser: ${error.message}. Download the WAV before leaving.`);
  }
  if (urls.has(run.part)) URL.revokeObjectURL(urls.get(run.part));
  urls.delete(run.part);
  takes.set(run.part, take);
  saving = false;
  $('transport-status').textContent = persisted ? 'Take saved · switch parts to build your duet' : 'Take ready · download a backup before leaving';
  $('beat-status').textContent = '';
  $('progress').style.width = '100%';
  document.querySelectorAll('.note.active').forEach(note => note.classList.remove('active'));
  if (peak < 0.008) warnings.push('The take is very quiet or silent. Check your microphone input and device mute before recording the other part.');
  notice(warnings.join(' '));
  renderExercise();
}

function showTargets(note) {
  const selected = selectedPart();
  $('your-target').textContent = noteName(note[selected]);
  $('other-target').textContent = noteName(note[otherPart(selected)]);
  $('melody-target').textContent = noteName(note.melody);
  $('harmony-target').textContent = noteName(note.harmony);
}
function resetPitch(message) {
  $('detected-note').textContent = '—';
  $('detected-frequency').textContent = 'Waiting for a clear, single note';
  $('pitch-card').className = 'pitch-card';
  $('needle').style.left = '50%';
  if (lastFeedback !== message) {
    $('pitch-message').textContent = message;
    lastFeedback = message;
  }
}

function drawHistory() {
  const canvas = $('pitch-history');
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!history.length) return;
  const pitches = history.flatMap(point => [point.target, point.other, ...(point.midi ? [point.midi] : [])]);
  const low = Math.min(...pitches) - 1;
  const high = Math.max(...pitches) + 1;
  const y = midi => canvas.height - 12 - (midi - low) / (high - low) * (canvas.height - 24);
  for (const [field, color] of [['target', '#237452'], ['other', '#b77324']]) {
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    history.forEach((point, index) => {
      const x = index / 119 * canvas.width;
      if (!index) context.moveTo(x, y(point[field]));
      else context.lineTo(x, y(point[field]));
    });
    context.stroke();
  }
  context.fillStyle = '#173b30';
  history.forEach((point, index) => {
    if (!point.midi) return;
    context.beginPath();
    context.arc(index / 119 * canvas.width, y(point.midi), 2.5, 0, 2 * Math.PI);
    context.fill();
  });
}

function tick(now) {
  requestAnimationFrame(tick);
  let note;
  try { note = makeTimeline(config()).notes[0]; } catch { return; }
  if (active) {
    const run = active;
    const time = engine.context.currentTime;
    if (time < run.timeline.start) {
      const remaining = Math.min(4, Math.ceil((run.timeline.start - time) / run.timeline.beat));
      $('transport-status').textContent = `Count in · ${remaining}`;
      $('beat-status').textContent = run.mode === 'record' ? 'Mic-only capture starts after count-in' : 'Get ready';
    } else if (time < run.timeline.end) {
      note = targetAt(run.timeline, time);
      const verb = run.mode === 'record' ? 'Recording' : run.mode === 'duet' ? 'Playing both takes' : 'Practicing';
      $('transport-status').textContent = `${verb}${run.mode !== 'duet' ? ` your ${partNames[run.part]}` : ''}`;
      $('beat-status').textContent = `Round ${Math.floor(note.index / 9) + 1}/${run.config.repeats} · beat ${note.index % 9 + 1}/9`;
      document.querySelectorAll('.note').forEach(element => element.classList.toggle('active', Number(element.dataset.index) === note.index % 9));
      $('progress').style.width = `${100 * (time - run.timeline.start) / (run.timeline.end - run.timeline.start)}%`;
    } else if (run.mode !== 'record') {
      active = null;
      engine.stop();
      $('transport-status').textContent = 'Exercise complete · take a breath';
      $('beat-status').textContent = '';
      $('progress').style.width = '100%';
      document.querySelectorAll('.note.active').forEach(element => element.classList.remove('active'));
      updateControls();
      engine.updateMix();
    } else if (time > run.timeline.end + 2) {
      stop('The recorder did not finish. The unfinished take was discarded. Reconnect your microphone and try again.');
    }
  }
  showTargets(note);
  if (now - lastPitchTime < 80) return;
  lastPitchTime = now;
  if (!engine.analyser) return;
  engine.analyser.getFloatTimeDomainData(engine.pitchBuffer);
  const hz = detectPitch(engine.pitchBuffer, engine.context.sampleRate);
  const selected = selectedPart();
  if (hz) {
    const assessment = assessPitch(hz, note[selected], note[otherPart(selected)]);
    $('detected-note').textContent = noteName(frequencyMidi(hz));
    $('detected-frequency').textContent = `${hz.toFixed(1)} Hz · ${assessment.cents >= 0 ? '+' : ''}${Math.round(assessment.cents)} cents from target`;
    $('pitch-card').className = `pitch-card ${assessment.kind}`;
    $('needle').style.left = `${50 + Math.max(-48, Math.min(48, assessment.cents * 0.48))}%`;
    if (lastFeedback !== assessment.text) {
      $('pitch-message').textContent = assessment.text;
      lastFeedback = assessment.text;
    }
  } else resetPitch('Sing or play one clear note. Quiet input is not scored.');
  history.push({ target: note[selected], other: note[otherPart(selected)], midi: hz ? frequencyMidi(hz) : null });
  if (history.length > 120) history.shift();
  drawHistory();
}

$('key').replaceChildren(...KEYS.map((name, value) => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = name;
  return option;
}));
document.querySelectorAll('.exercise-setting,[name=part]').forEach(element => element.addEventListener(element.id === 'bpm' ? 'input' : 'change', () => {
  notice('');
  renderExercise();
}));
$('use-take').addEventListener('change', renderExercise);
for (const id of ['melody-volume', 'harmony-volume', 'assistance', 'guide']) $(id).addEventListener('input', () => engine.updateMix());
$('reset-assistance').onclick = () => { $('assistance').value = 0; engine.updateMix(); };
$('practice').onclick = () => start('practice');
$('record').onclick = () => start('record');
$('play-duet').onclick = () => start('duet');
$('stop').onclick = () => stop();
$('mic').onclick = async () => {
  if (engine.stream) {
    if (active?.mode === 'record') stop('Recording stopped because the microphone was disconnected. Your previous saved take is unchanged.');
    engine.releaseMic();
    return;
  }
  const token = ++sequence;
  starting = true;
  updateControls();
  try {
    await engine.enableMic();
    if (token !== sequence) engine.releaseMic();
    else notice('');
  } catch (error) { notice(error.message); }
  finally {
    starting = false;
    if (token !== sequence) $('transport-status').textContent = 'Start cancelled · microphone disconnected';
    updateControls();
  }
};
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && (active || starting)) stop();
});
window.addEventListener('pagehide', () => {
  engine.stop();
  engine.releaseMic();
  engine.context?.close();
  for (const url of urls.values()) URL.revokeObjectURL(url);
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (active || starting)) stop('Exercise stopped when the page was hidden. Keep this page visible while recording; unfinished takes are discarded.');
});
try {
  for (const take of await openStore()) takes.set(take.part, take);
  storageReady = true;
} catch (error) {
  $('storage-status').textContent = `Browser storage is unavailable: ${error.message}. Takes will last only for this visit; download your WAV files.`;
  notice('Local recording storage is unavailable. You can still practice and record, but download each take before leaving.');
}
renderExercise();
requestAnimationFrame(tick);
