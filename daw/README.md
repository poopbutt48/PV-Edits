# Beatforge

A touch-first music studio for Android (and any modern browser): step sequencer, piano roll, playlist,
mixer, 18 effects, 5 instruments, automation, MIDI and WAV export — all running locally with the Web Audio API.
No build step, no dependencies, no server.

See **[FEATURES.md](FEATURES.md)** for exactly what is and is not implemented.

## Run it

It is plain HTML/CSS/JS. Serve this folder over HTTP(S) and open `index.html`:

```sh
cd daw && python3 -m http.server 8000      # then open http://localhost:8000/
```

`index.html` also works from `file://` for quick looks, but offline caching, install-to-home-screen and
Web MIDI need `https://` or `localhost`.

### Install on Android

1. Host the folder somewhere with HTTPS (for example GitHub Pages) and open it in Chrome on the phone.
2. Chrome menu → **Install app** (or **Add to Home screen**), or use **Menu → Options → Install as app** inside Beatforge.
3. It then starts full-screen, works offline, and keeps projects and imported samples on the device (IndexedDB).

USB / Bluetooth MIDI keyboards work in Chrome on Android through Web MIDI (**Menu → Options → MIDI devices**).

## Using it on a phone

* **Rack** – tap steps; hold a step and drag to paint; hold a lit step for velocity/pan/pitch; hold a channel name for its menu.
* **Piano roll** – tap to add a note, drag sideways to set its length; drag to move; drag the right edge to resize;
  two fingers to pan and pinch-zoom; hold a note for its properties.
* **Playlist** – pick a pattern in the top bar, tap to place it; drag the ruler to set a loop; hold the ruler for markers.
* **Knobs** – drag; double-tap resets; hold for typed values and **Create automation clip**.
* **Orange key button** – on-screen piano that records into the selected channel.

## Code map

```
index.html              page shell, script order
css/app.css             all styles (rem-based, scales with Settings → Interface size)
js/util.js              helpers, DOM builder, icons, parameter mapping, constants
js/settings.js          64 preferences, schema-driven
js/db.js                IndexedDB wrapper (projects, samples)
js/fx.js                18 effects: parameter tables + Web Audio graphs
js/inst.js              instruments + shared channel parameters (arp, echo, swing …)
js/samples.js           36 generated factory sounds, imports, waveform peaks, time-stretch
js/state.js             project model, undo/redo, save/load
js/audio.js             mixer graph (tracks, channels, voices), live context, metronome
js/seq.js               transport, scheduling shared by playback and offline render, automation, recording
js/export.js            WAV encoder, MIDI export/import, project bundles
js/templates.js         starter projects
js/ui-*.js              widgets, shell, rack, channel sheet, browser, mixer, piano roll, playlist,
                        automation editor, keyboard / MIDI, settings & tools
js/app.js               boot
sw.js, manifest.webmanifest, icons/    PWA
tests/smoke.js          Playwright smoke test
```

Design notes:

* Instruments and effects are **tables of parameters**. The UI, automation and saving are generated from the table,
  so adding a knob means adding one line plus the code that uses it.
* Playback and export use the *same* scheduler (`scheduleRange`), so what you hear is what is rendered.
* Time is stored in ticks (96 per quarter note); audio is scheduled ahead on the Web Audio clock from a worker timer.

## Tests

```sh
npm i playwright            # any Chromium build that Playwright can launch
node tests/smoke.js
```

The smoke test renders every template, effect and instrument offline and checks for finite, non-silent audio,
then drives the real UI (painting steps, drawing/moving/resizing notes, pinch-zoom, playlist placement, mixer, MIDI and WAV export).

## Notes

* "FL Studio" is a trademark of Image-Line. Beatforge is an unaffiliated project; it shares no code, assets or file formats with it.
* Browser limits: Web Audio has no insert-effect plugin hosting, and a tab in the background may be throttled by the browser.
