# Harmony Duet

A separate, local browser-native harmony practice app. No account, external assets, uploaded audio, build step, or production dependencies. The `harmony-trainer` project is not used or modified.

## Run

Requires Node.js 20 or newer:

```sh
cd ~/src/harmony-duet
npm start
```

Open **http://localhost:4173** in a current desktop Chrome, Edge, Firefox, or Safari. Microphone access requires localhost or HTTPS; do not open `index.html` directly. `PORT=4174 npm start` selects another port. The server binds to loopback only.

## Practice

- Defaults: **C major, tonic C4, 90 BPM, one 9-beat round**, four count-in clicks. Melody: **1, 2, 3, 4, 5, 4, 3, 2, 1**. Harmony repeats **1** or **5**, rearticulated every beat. Both use the same tonic register.
- Choose your melody or steady harmony, set key/register/tempo/rounds, and press **Practice**. Each exercise is finite. Press Stop or Escape to cancel; hiding the page stops the exercise rather than risking background timing drift.
- **Enable microphone** for live note, exact-octave cents, target, recent pitch trace, and an amber warning when you sing the other line. Sing/play one clear note; this is a monophonic pitch detector, not chord recognition. Shared notes are correctly treated as belonging to both lines. Outside an exercise, the target is its first beat.
- Both synthesized parts have independent baseline volumes. **Hear my part clearly** starts off: turn it up to raise your selected line and soften the other. Gradually reduce it toward zero, or press **Return to normal mix**. Baseline sliders are not changed. Assistance can add your selected synth guide even if the guide checkbox is off; turning assistance back to zero restores that checkbox's behavior.
- You can turn off your synthesized guide and sing only against the other line. Assistance and volume changes are live and do not affect captured microphone samples.

## Record a duet, either way around

1. **Wear headphones.** Select either part and press **Record my…**. Grant microphone permission. After four clicks, record the displayed nine-note exercise. The counter shows the recording window. No microphone audio is ever monitored to speakers.
2. The completed **microphone-only** take appears below with solo playback and WAV download. Silence, count-in and guide audio are not digitally mixed into the take: only samples from the exercise window are captured. Acoustic bleed through speakers can still be recorded, hence headphones.
3. Switch to the opposite part. Leave **Hear my saved opposite part** checked. A matching saved take replaces that part's synth, starting on the same exercise clock after the count-in. Practice against it, or record your other part while hearing it. Listening assistance still emphasizes your selected synthesized guide and softens the saved opposite take.
4. With two matching takes, **Play both takes** starts them together after the count-in. Assistance then emphasizes the selected recorded part, not an added synth. Individual take players play the raw recording without the practice mix or count-in.

This works melody-first or harmony-first. One completed take per part is retained. Replacing an existing take asks for confirmation; stopping an unfinished take keeps the previous one. Disconnecting/muting the microphone or interrupting audio cancels unfinished capture. The microphone stays available for feedback after a take; **Disconnect microphone** releases it, and leaving the page also releases audio resources.

## Local saving, settings and timing

Completed takes are stored in IndexedDB **in this browser profile and origin**. Keep the same localhost hostname/port to find them next time. Private browsing, clearing site data, storage quotas or browser eviction may remove recordings. Storage failures are shown explicitly; an unsaved take remains usable for the visit and downloadable. Download important WAVs before closing the page.

Changing key, tonic register, tempo, harmony degree or rounds makes old takes incompatible. They remain playable/downloadable, but are never silently stretched, transposed or used for overdubbing. **Use these settings** restores the take's original exercise. Exercise settings and part choice are locked while running. Volumes, assistance and guide remain adjustable.

Synthesis, previous-take playback and microphone capture share one Web Audio sample clock. An AudioWorklet captures exact frame boundaries into mono 16-bit PCM WAVs, without count-in or codec padding. Audio device input/output latency and a human's response time are **not calibrated**: hardware can still introduce a small overdub offset. Use wired headphones and a low-latency input for best results. The limiter provides mix headroom but cannot repair microphone clipping.

## Checks

```sh
npm test
```

Node's built-in tests cover scale/key/octave mapping, both-line timing, repetitions, setting compatibility, other-line feedback, assistance/zero restoration, pitch detection at 44.1/48 kHz, WAV shape and the actual recording worklet's sample trimming/cancellation. Real device sound quality, permission behavior and hardware latency still need a microphone/headphone check on your own browser.

For repeatable end-to-end checks, with the local server running:

```sh
npm install
npm run test:browser
```

The browser check uses installed Google Chrome and **synthetic microphone tones**, not your hardware. It exercises both overdub directions, checks microphone-only audio and sample-clock alignment, live pitch, actual assistance gains/reset, cancellation, setting compatibility, reload persistence, take playback, microphone cleanup, denied permission, storage failure and narrow-screen layout in a temporary browser profile. It leaves no test recordings in your normal browser. Set `APP_URL` for another local port. If Chrome is not installed, run `npx playwright install chromium` and `BROWSER_CHANNEL=chromium npm run test:browser`. Playwright is a development-only dependency; starting/using the app requires no package installation.

## Files

`server.js` serves `public/`; `app.js` owns the interface and audio lifecycle; `music.js` contains pure musical/timing/mix/WAV helpers; `pitch.js` is the downsampled YIN detector; `capture-worklet.js` captures only mic input; `storage.js` handles IndexedDB.
