# Beatforge — feature checklist

An honest list of what exists today. ✅ = built and exercised by `tests/smoke.js` or by hand in a browser,
🟡 = partly there (the note says what is missing), ❌ = not built.

Beatforge is an independent music studio for touch screens. It borrows the *workflow* of desktop DAWs
(channel rack → piano roll → playlist → mixer) but none of their code, sounds or artwork. It does not
read or write any commercial DAW's project format.

**Testing status.** Everything below was developed and tested in desktop Chromium (headless, Linux)
with a phone-sized viewport and simulated touch. It has **not** been run on a real Android phone, with
real MIDI hardware, or with a real microphone, so audio latency, haptics and Bluetooth/USB MIDI behaviour
on actual devices are unverified. The microphone-recording and Web MIDI code paths are written but could not be exercised in the test browser.

## Transport & project

| | Feature |
|---|---|
| ✅ | Play / pause / stop / record, pattern mode and song mode, loop |
| ✅ | Tempo 10–999 BPM (drag, type, tap tempo, half/double), time signature (2–12 over 4/8/16), global swing, master pitch |
| ✅ | Metronome (4 sounds, accent, volume, "always" or "recording only"), count-in 0/1/2/4 bars, wait-for-first-note recording |
| ✅ | Bars:Beats:Ticks or Min:Sec:Cs clock, follow-playhead (off / page / smooth), keep-screen-on while playing |
| ✅ | Undo / redo (150 steps, labelled), auto-save, reopen last project, save / open / delete projects on the device |
| ✅ | Project info (title, author, genre, comments), 4 starter templates |
| ✅ | Project file with embedded samples (export / import) |
| ❌ | Tempo automation / tempo-change markers, time-signature changes mid-song |
| ❌ | Clip-launching "performance mode", project history browser |

## Channel rack (step sequencer)

| | Feature |
|---|---|
| ✅ | Steps with velocity shading, tap to toggle, drag-paint (mouse, or long-press then drag on touch), paint-mode toggle |
| ✅ | Per-step properties sheet: velocity, pan, release, fine pitch, mod X, mod Y, slide, key |
| ✅ | Graph editor lane for the selected channel (velocity / pan / release / pitch / mod X / mod Y) |
| ✅ | Mute, solo, rename, colour, route to mixer insert, clone, move, delete, fill every 2nd/4th, shift, clear, randomize |
| ✅ | Pattern picker, new / clone / rename / colour / clear / length, pattern length in bars |
| ✅ | Layer channels (one channel triggers several) |
| ✅ | Auto-route new channels to a free mixer insert (setting) |
| 🟡 | Channel types: Sampler, Synth, FM synth, Pluck, Drum synth, Layer, Audio clip, Automation clip. No wavetable / additive / granular instruments |
| ❌ | Hosting third-party plugins (VST/AU/CLAP) — not possible in a browser |

## Instruments

All instrument controls are generated from parameter tables, so every knob listed in a channel's settings is wired to the audio engine.

| | Feature |
|---|---|
| ✅ | **Sampler**: root note, tune, start/end, reverse, loop points, one-shot, volume envelope (ADSR), pitch envelope, filter (5 types, env, velocity), LFO (pitch/volume/cutoff/pan), slice-to-channels |
| ✅ | **Synth**: 3 oscillators (10 waveforms incl. pulse/organ/bell/vowel), per-oscillator octave/semitone/fine/level, up to 7-voice unison with detune and spread, sub, noise, osc-2→osc-1 FM, drive, portamento, mono/legato, filter (LP/HP/BP/notch/peak, 12 or 24 dB, key tracking), amp + filter ADSR, two LFOs with 5 targets, 14 presets |
| ✅ | **FM synth**: 3 operators, 5 algorithms, per-operator ratio/fine/level/ADSR, feedback, 5 presets |
| ✅ | **Pluck**: Karplus–Strong string, sustain, brightness, hard pick, low-pass |
| ✅ | **Drum synth**: kick, snare, clap, closed/open hat, tom, rim, cowbell, FM perc |
| ✅ | Per channel: arpeggiator (5 directions, 1–4 octaves, rate, gate, 25 chord presets), echo (tempo-synced), swing, note delay, time shift, note-length scale, cut groups, cut-itself, polarity invert, swap L/R, velocity→volume, polyphony cap (setting) |
| ✅ | Factory sounds: 36 sounds generated in code (kicks, snares, claps, hats, toms, percussion, cymbals, FX, bass, melodic one-shots) |
| ✅ | Import WAV / MP3 / OGG / FLAC / M4A samples (kept on the device), preview before use |
| 🟡 | Pitch-bend range applies to a MIDI keyboard's pitch wheel; piano-roll "slide" notes glide only when the synth's portamento is above 0 |
| ❌ | Sample-accurate drum-machine kits, multi-sample instruments, SoundFont playback |

## Piano roll

| | Feature |
|---|---|
| ✅ | Draw (tap, then drag sideways to set length), move, resize, select (marquee / tap), erase, slice, mute, pan tools |
| ✅ | Two-finger pan and pinch zoom (independent X and Y), mouse wheel / Ctrl-wheel on desktop |
| ✅ | Snap grid (none, cell, 1/6 step … bar), ghost notes from other channels, key labels, note-name labels, velocity shading |
| ✅ | Scale highlight + lock (20 scales, any root), chord stamp (25 chords) |
| ✅ | Touch-keyboard gutter, auditioning while drawing / moving |
| ✅ | Edit menu: select all / invert, copy / paste / duplicate / delete, transpose, quantize (start / end / both), set length, legato, chop, stretch, reverse, flip, strum, snap-to-scale, humanize, random velocity, mute |
| ✅ | Controller lanes: velocity, pan, release, pitch, mod X, mod Y (freehand across notes) |
| ✅ | Per-note properties sheet (velocity, pan, release, fine pitch, mod X/Y, slide, key) |
| ✅ | Idea generator: melody, chords, bass line, drum pattern, using the chosen scale |
| ✅ | Record from touch keys, computer keyboard or MIDI, with optional quantize |
| ❌ | Riff machine, flam / limit / claw-machine tools |

## Playlist

| | Feature |
|---|---|
| ✅ | Pattern, audio and automation clips on up to 500 tracks; draw, move across bars/tracks, resize, trim, slice, erase, mute, select |
| ✅ | Pattern previews and waveforms drawn inside clips, repeating pattern clips |
| ✅ | Loop region (drag the ruler), markers (long-press the ruler), track rename / colour / mute / solo / insert / delete / clear |
| ✅ | Audio clips: gain, pan, pitch, reverse, fades, **pitch-preserving time-stretch** to the project tempo |
| ✅ | Copy / paste / duplicate, make-unique pattern clones |
| ❌ | Per-clip colour, track groups / folders, time-signature markers |

## Mixer

| | Feature |
|---|---|
| ✅ | Master + up to 125 inserts, 10 effect slots each (add / replace / reorder / bypass / duplicate / remove), dry-wet per effect |
| ✅ | Per track: fader (0 dB marker, double-tap reset), pan, stereo width, phase invert, swap L/R, delay, mute, solo (follows sends), 3-band EQ, peak meters with hold |
| ✅ | Routing: any insert to any other (loops prevented) with send levels |
| ✅ | Master safety limiter + soft ceiling (setting) |
| ✅ | 18 effects (below) |
| 🟡 | Sidechain: the Volume Shaper does tempo-synced ducking / gating; there is no signal-triggered external sidechain |
| ❌ | Plugin delay compensation (not needed for built-in effects), mixer presets |

## Effects

Parametric EQ (7 bands, interactive graph with live spectrum) · Filter (8 types, LFO) · Compressor · Limiter ·
Multiband Compressor (3 bands) · Reverb · Convolution Reverb (any sample as the impulse) · Delay (tempo sync, ping-pong) ·
Chorus · Flanger · Phaser · Tremolo / Auto-pan · Distortion (6 types incl. bit crush and wave fold) · Tape / Lo-fi ·
Stereo Shaper · Gain / Phase utility · Volume Shaper (16-step sidechain / gate) · Analyzer (spectrum, scope, bars).
All parameters can be automated; changes apply to timed automation sample-accurately where the Web Audio parameter allows it.

❌ Not built: vocoder, pitch shifter / auto-tune, transient shaper, noise gate, granular effects, sample-rate-reduction crusher.

## Automation

| | Feature |
|---|---|
| ✅ | Hold any knob → "Create automation clip" (channel volume / pan, instrument knobs, mixer volume / pan / sends, effect knobs, effect mix) |
| ✅ | Curve editor: add / drag / delete points, per-segment curve bend, step (hold) segments, LFO fill shapes, invert / reverse / flatten, length, snap |
| 🟡 | Instrument-knob automation is applied when each note starts (a held note does not follow later changes) |

## Browser, import / export

| | Feature |
|---|---|
| ✅ | Browser: samples (search, categories, preview, add to rack / playlist / convolver), synth & FM presets, effects, projects & templates |
| ✅ | Export WAV (16 / 24 / 32-bit float, 22.05–96 kHz, dither, normalize, tail length), whole song or current pattern, per-track stems |
| ✅ | Export / import Standard MIDI Files, drag-and-drop of audio, MIDI and project files |
| ✅ | Record from the microphone straight into a playlist audio clip |
| ❌ | MP3 / FLAC / OGG export, import of other DAWs' project files |

## Input

| | Feature |
|---|---|
| ✅ | On-screen piano (1–3 octaves, multi-touch, velocity from touch height, hold, one-finger chords) |
| ✅ | Computer keyboard as piano, Web MIDI input (notes, sustain pedal, pitch wheel, velocity curves, transpose) |
| ❌ | MIDI learn / controller linking, MIDI output, MIDI clock |

## Settings (64)

General · Touch & gestures · Audio · MIDI & keyboard · Metronome & recording · Piano roll · Playlist · Mixer · Export.
Every entry is read by the code (checked with a script); open **Menu → Options → Settings**.

## App shell

| | Feature |
|---|---|
| ✅ | Installable PWA (manifest, icons, offline service worker), portrait / landscape / tablet layouts |
| ✅ | Android back gesture closes sheets, haptics, safe-area insets, accent colour and UI-size settings |
| ❌ | Native Android APK — this build runs in Chrome / as an installed web app. A native shell (for example Capacitor) can wrap it, but that has not been built or tested here |
