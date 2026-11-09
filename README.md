# Harmony Duet

A separate, browser-native harmony practice app. No account, external assets, uploaded audio, build step, or production dependencies. The `harmony-trainer` project is not used or modified.

## Use and share online

Open **https://jimmycalhoun.github.io/harmony-duet/** in a current Chrome, Edge, Firefox, or Safari. Share that link; no installation or account is needed. Allow microphone access when you enable the mic or record, and wear headphones.

The app runs entirely in your browser. Microphone audio and saved takes are not uploaded to GitHub or shared with anyone who opens the link. Recordings stay in the browser profile that made them; the online site and localhost have separate recording storage. Download WAVs to keep or share recordings.

### GitHub Pages deployment

GitHub Pages uses **GitHub Actions** as its source (repository **Settings → Pages → Build and deployment**). `.github/workflows/pages.yml` runs the unit checks and publishes only `public/` when that directory or the workflow changes on `main`. You can also run **Deploy GitHub Pages** manually from the Actions tab. There is no build or server needed on Pages; relative asset, module and AudioWorklet paths support the `/harmony-duet/` project URL. The deployment's live URL appears in the `github-pages` environment.

## Run

Requires Node.js 20 or newer:

```sh
cd ~/src/harmony-duet
npm start
```

Open **http://localhost:4173** in a current desktop Chrome, Edge, Firefox, or Safari. Microphone access requires localhost or HTTPS; do not open `index.html` directly. `PORT=4174 npm start` selects another port. The server binds to loopback only.

## Practice

- Defaults: **C major, tonic C4, 90 BPM, one 9-beat round**, four count-in clicks. Melody always follows **1, 2, 3, 4, 5, 4, 3, 2, 1**. Under **Harmony pattern**, choose repeated **1** (the default), repeated **5**, **1 → 5 · switch on beat 5**, **Third above**, **Third below**, or **Sixth above**. Each harmony degree aligns with one melody beat and is rearticulated every beat. The complete nine-beat pattern restarts each round.
- Choose your melody or harmony, set pattern/key/register/tempo/rounds, and press **Practice**. Each exercise is finite. Press Stop or Escape to cancel; hiding the page stops the exercise rather than risking background timing drift.
- **Enable microphone** for live note, exact-octave cents, target, recent pitch trace, and an amber warning when you sing the other line. Sing/play one clear note; this is a monophonic pitch detector, not chord recognition. Shared notes are correctly treated as belonging to both lines. Outside an exercise, the target is its first beat.
- Both synthesized parts have independent baseline volumes. **Hear my part clearly** starts off: turn it up to raise your selected line and soften the other. Gradually reduce it toward zero, or press **Return to normal mix**. Baseline sliders are not changed. Assistance can add your selected synth guide even if the guide checkbox is off; turning assistance back to zero restores that checkbox's behavior.
- You can turn off your synthesized guide and sing only against the other line. Assistance and volume changes are live and do not affect captured microphone samples.

### Harmony practices

| Pattern | Harmony degrees | Notes with tonic C4 |
|---|---|---|
| Repeated tonic | 1, 1, 1, 1, 1, 1, 1, 1, 1 | C4 throughout |
| Repeated dominant | 5, 5, 5, 5, 5, 5, 5, 5, 5 | G4 throughout |
| Switch on beat 5 | 1, 1, 1, 1, 5, 5, 5, 5, 5 | C4 four times, then G4 five times |
| Third above | 3, 4, 5, 6, 7, 6, 5, 4, 3 | E4, F4, G4, A4, B4, A4, G4, F4, E4 |
| Third below | 6↓, 7↓, 1, 2, 3, 2, 1, 7↓, 6↓ | A3, B3, C4, D4, E4, D4, C4, B3, A3 |
| Sixth above | 6, 7, 1↑, 2↑, 3↑, 2↑, 1↑, 7, 6 | A4, B4, C5, D5, E5, D5, C5, B4, A4 |

These are **diatonic** intervals: two major-scale steps above/below for thirds, five above for sixths, not fixed semitone transpositions. The selected key/register sets the tonic for both lines. **↓** and **↑** mark degrees in the lower/upper scale octave; note names show the exact sounding register (a transposed scale can cross a scientific note-octave boundary elsewhere). Pick a comfortable tonic register: Third below dips below the tonic, and Sixth above reaches beyond the upper tonic. Pitch feedback covers the full selectable exercise range, including the highest sixth-above notes.

## Record a duet, either way around

1. **Wear headphones.** Select either part and press **Record my…**. Grant microphone permission. After four clicks, record the displayed nine-note exercise. The counter shows the recording window. No microphone audio is ever monitored to speakers.
2. The completed **microphone-only** take appears below with solo playback and WAV download. Silence, count-in and guide audio are not digitally mixed into the take: only samples from the exercise window are captured. Acoustic bleed through speakers can still be recorded, hence headphones.
3. Switch to the opposite part. Leave **Hear my saved opposite part** checked. A matching saved take replaces that part's synth, starting on the same exercise clock after the count-in. Practice against it, or record your other part while hearing it. Listening assistance still emphasizes your selected synthesized guide and softens the saved opposite take.
4. With two matching takes, **Play both takes** starts them together after the count-in. Assistance then emphasizes the selected recorded part, not an added synth. Individual take players play the raw recording without the practice mix or count-in.

This works melody-first or harmony-first. One completed take per part is retained. Replacing an existing take asks for confirmation; stopping an unfinished take keeps the previous one. Disconnecting/muting the microphone or interrupting audio cancels unfinished capture. The microphone stays available for feedback after a take; **Disconnect microphone** releases it, and leaving the page also releases audio resources.

## Local saving, settings and timing

Completed takes are stored in IndexedDB **in this browser profile and origin**. Reopen the same online site, or keep the same localhost hostname/port, to find them next time. GitHub Pages projects on the same hostname share an origin; this app's `harmony-duet` database is not an account or cloud backup. Private browsing, clearing site data, storage quotas or browser eviction may remove recordings. Storage failures are shown explicitly; an unsaved take remains usable for the visit and downloadable. Download important WAVs before closing the page.

Changing key, tonic register, tempo, harmony pattern or rounds makes old takes incompatible, even when the recorded melody is unchanged. They remain playable/downloadable, but are never silently stretched, transposed or used for overdubbing. **Use these settings** restores the take's original exercise, including its harmony pattern. Existing takes remain compatible with their original patterns. All six patterns support recording either part first, live pitch/drift feedback and listening assistance. Exercise settings and part choice are locked while running. Volumes, assistance and guide remain adjustable.

Synthesis, previous-take playback and microphone capture share one Web Audio sample clock. An AudioWorklet captures exact frame boundaries into mono 16-bit PCM WAVs, without count-in or codec padding. Audio device input/output latency and a human's response time are **not calibrated**: hardware can still introduce a small overdub offset. Use wired headphones and a low-latency input for best results. The limiter provides mix headroom but cannot repair microphone clipping.

## Checks

```sh
npm test
```

Node's built-in tests cover exact pitches for all patterns, diatonic thirds/sixths and octave boundaries, key/register transposition, repeated-round beat alignment, legacy/pattern recording compatibility, other-line feedback, assistance/zero restoration, pitch detection at 44.1/48 kHz through the highest selectable note, WAV shape and the actual recording worklet's sample trimming/cancellation. Real device sound quality, permission behavior and hardware latency still need a microphone/headphone check on your own browser.

For repeatable end-to-end checks, with the local server running:

```sh
npm install
npm run test:browser
```

The browser check uses installed Google Chrome and **synthetic microphone tones**, not your hardware. It exercises both overdub directions for the original, switching and all three interval patterns, verifies scheduled synth frequencies, octave labels and beat alignment, changing pitch/drift targets, pattern compatibility/restoration after reload, microphone-only audio, sample-clock alignment, actual assistance gains/reset, cancellation, take playback, microphone cleanup, denied permission, storage failure and narrow-screen layout in a temporary browser profile. It leaves no test recordings in your normal browser. Set `APP_URL` for another local port or use `APP_URL=https://jimmycalhoun.github.io/harmony-duet/ npm run test:browser` to check the published site. If Chrome is not installed, run `npx playwright install chromium` and `BROWSER_CHANNEL=chromium npm run test:browser`. Playwright is a development-only dependency; starting/using the app requires no package installation.

## Files

`server.js` serves `public/`; `app.js` owns the interface and audio lifecycle; `music.js` contains pure musical/timing/mix/WAV helpers; `pitch.js` is the downsampled YIN detector; `capture-worklet.js` captures only mic input; `storage.js` handles IndexedDB.
