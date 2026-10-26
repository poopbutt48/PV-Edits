'use strict';
/* Beatforge — user preferences. Schema-driven so the Settings screen builds itself from this table. */
(() => {
const DAW = window.DAW;
const U = DAW.util;

const O = (...a) => a.map(x => (Array.isArray(x) ? { v: x[0], l: x[1] } : { v: x, l: String(x) }));

const SCHEMA = [
  { group: 'General', icon: 'gear', items: [
    { id: 'accent', type: 'color', label: 'Accent colour', def: '#ff8a3d', opts: ['#ff8a3d', '#37d6c5', '#5f9bff', '#c58bff', '#ff5fa2', '#a3e635', '#feca57', '#ff5252'] },
    { id: 'uiScale', type: 'select', label: 'Interface size', def: 1, opts: O([0.85, 'Compact'], [1, 'Normal'], [1.15, 'Large'], [1.3, 'Extra large']) },
    { id: 'timeFormat', type: 'select', label: 'Time display', def: 'bbt', opts: O(['bbt', 'Bars : Beats : Ticks'], ['msc', 'Minutes : Seconds : Centis']) },
    { id: 'followPlayhead', type: 'select', label: 'Follow playhead', def: 'page', opts: O(['off', 'Off'], ['page', 'Page turn'], ['smooth', 'Smooth scroll']) },
    { id: 'haptics', type: 'toggle', label: 'Haptic feedback', help: 'Short vibration on step toggles and detents.', def: true },
    { id: 'wakeLock', type: 'toggle', label: 'Keep screen on while playing', def: true },
    { id: 'autosave', type: 'select', label: 'Auto-save', def: 30, opts: O([0, 'Off'], [15, 'Every 15 s'], [30, 'Every 30 s'], [60, 'Every minute'], [300, 'Every 5 minutes']) },
    { id: 'restoreLast', type: 'toggle', label: 'Reopen last project on start', def: true },
    { id: 'confirmDelete', type: 'toggle', label: 'Confirm before deleting channels, patterns and tracks', def: true },
    { id: 'autoRoute', type: 'toggle', label: 'Route new channels to a free mixer insert', def: true },
    { id: 'showCpu', type: 'toggle', label: 'Show audio load meter', def: true },
    { id: 'reduceMotion', type: 'toggle', label: 'Reduce motion', def: false },
  ] },
  { group: 'Touch & gestures', icon: 'hand', items: [
    { id: 'knobSens', type: 'range', label: 'Knob drag sensitivity', def: 1, min: 0.4, max: 2.5, step: 0.1, fmt: v => v.toFixed(1) + '×' },
    { id: 'knobDoubleTap', type: 'toggle', label: 'Double-tap a control to reset it', def: true },
    { id: 'longPressMs', type: 'select', label: 'Long-press delay', def: 450, opts: O([300, 'Short (300 ms)'], [450, 'Normal (450 ms)'], [650, 'Long (650 ms)'], [850, 'Very long (850 ms)']) },
    { id: 'stepPaint', type: 'toggle', label: 'Drag across steps to paint them', def: true },
    { id: 'stylusOnly', type: 'toggle', label: 'Stylus draws, fingers only scroll', help: 'In editors, pen input edits and touch pans/zooms.', def: false },
    { id: 'bigHandles', type: 'toggle', label: 'Large touch handles on notes and clips', def: true },
    { id: 'twoFingerNav', type: 'toggle', label: 'Two-finger pan / pinch zoom in editors', def: true },
  ] },
  { group: 'Audio', icon: 'speaker', items: [
    { id: 'latency', type: 'select', label: 'Latency mode', help: 'Takes effect after Restart audio.', def: 'interactive', opts: O(['interactive', 'Lowest latency'], ['balanced', 'Balanced'], ['playback', 'Battery saver']) },
    { id: 'sampleRate', type: 'select', label: 'Sample rate', help: 'Takes effect after Restart audio.', def: 0, opts: O([0, 'Device default'], [44100, '44.1 kHz'], [48000, '48 kHz']) },
    { id: 'maxVoices', type: 'select', label: 'Polyphony per channel', def: 24, opts: O(8, 12, 16, 24, 32, 48, 64) },
    { id: 'masterLimiter', type: 'toggle', label: 'Master safety limiter', help: 'Soft-limits the final output to stop harsh clipping.', def: true },
    { id: 'previewVol', type: 'range', label: 'Browser / keyboard preview volume', def: 0.8, min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
  ] },
  { group: 'MIDI & keyboard', icon: 'keys', items: [
    { id: 'midiEnabled', type: 'toggle', label: 'Enable MIDI input (USB / Bluetooth)', def: true },
    { id: 'midiVelCurve', type: 'select', label: 'MIDI velocity curve', def: 'linear', opts: O(['linear', 'Linear'], ['soft', 'Soft'], ['hard', 'Hard'], ['fixed', 'Fixed (100)']) },
    { id: 'midiTranspose', type: 'select', label: 'Input transpose', def: 0, opts: O([-24, '-2 octaves'], [-12, '-1 octave'], [0, 'None'], [12, '+1 octave'], [24, '+2 octaves']) },
    { id: 'typingKeys', type: 'toggle', label: 'Use computer keyboard as piano', def: true },
    { id: 'recQuant', type: 'select', label: 'Quantize while recording', def: 'none', opts: O(['none', 'Off'], ['step', 'Step'], ['1/2b', '1/2 beat'], ['beat', 'Beat']) },
    { id: 'kbVelFromY', type: 'toggle', label: 'On-screen keys: velocity from touch position', def: true },
    { id: 'kbLabels', type: 'select', label: 'On-screen key labels', def: 'c', opts: O(['none', 'None'], ['c', 'C notes only'], ['all', 'All notes']) },
  ] },
  { group: 'Metronome & recording', icon: 'metro', items: [
    { id: 'metroMode', type: 'select', label: 'Metronome plays', def: 'always', opts: O(['always', 'During playback and recording'], ['rec', 'Only while recording']) },
    { id: 'metroVol', type: 'range', label: 'Metronome volume', def: 0.6, min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { id: 'metroSound', type: 'select', label: 'Metronome sound', def: 'click', opts: O(['click', 'Click'], ['beep', 'Beep'], ['wood', 'Woodblock'], ['cowbell', 'Cowbell']) },
    { id: 'metroAccent', type: 'toggle', label: 'Accent the downbeat', def: true },
    { id: 'countIn', type: 'select', label: 'Count-in before recording', def: 1, opts: O([0, 'None'], [1, '1 bar'], [2, '2 bars'], [4, '4 bars']) },
    { id: 'waitInput', type: 'toggle', label: 'Wait for first note before recording', def: false },
    { id: 'loopRec', type: 'toggle', label: 'Keep recording notes when the pattern loops', def: true },
  ] },
  { group: 'Piano roll', icon: 'piano', items: [
    { id: 'prDefLen', type: 'select', label: 'Default note length', def: 24, opts: O([6, '1/4 step'], [12, '1/2 step'], [24, '1 step'], [48, '2 steps'], [96, '1 beat'], [192, '2 beats'], [384, '1 bar']) },
    { id: 'prDefVel', type: 'range', label: 'Default velocity', def: 100, min: 1, max: 127, step: 1, fmt: v => String(Math.round(v)) },
    { id: 'prPreview', type: 'toggle', label: 'Preview notes when drawing and moving', def: true },
    { id: 'prGhost', type: 'toggle', label: 'Show ghost notes from other channels', def: true },
    { id: 'prKeyLabels', type: 'select', label: 'Key labels', def: 'c', opts: O(['none', 'None'], ['c', 'C notes only'], ['all', 'All notes']) },
    { id: 'prScaleHL', type: 'toggle', label: 'Highlight scale', def: false },
    { id: 'prScaleRoot', type: 'select', label: 'Scale root', def: 0, opts: O(...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((n, i) => [i, n])) },
    { id: 'prScaleName', type: 'select', label: 'Scale', def: 'Major', opts: () => O(...Object.keys(DAW.C.SCALES)) },
    { id: 'prScaleLock', type: 'toggle', label: 'Lock drawn notes to the scale', def: false },
    { id: 'prNoteLabels', type: 'toggle', label: 'Show note names inside notes', def: true },
    { id: 'prVelColor', type: 'toggle', label: 'Shade notes by velocity', def: true },
  ] },
  { group: 'Playlist', icon: 'playlist', items: [
    { id: 'plTrackH', type: 'select', label: 'Track height', def: 56, opts: O([40, 'Small'], [56, 'Medium'], [76, 'Large'], [104, 'Extra large']) },
    { id: 'plClipPreview', type: 'toggle', label: 'Draw note previews inside pattern clips', def: true },
    { id: 'plWaveforms', type: 'toggle', label: 'Draw waveforms inside audio clips', def: true },
    { id: 'plTrackCount', type: 'select', label: 'Visible tracks at start', def: 24, opts: O(12, 24, 48, 100, 200, 500) },
  ] },
  { group: 'Mixer', icon: 'mixer', items: [
    { id: 'mxStripW', type: 'select', label: 'Strip width', def: 76, opts: O([64, 'Narrow'], [76, 'Normal'], [92, 'Wide']) },
    { id: 'mxMeterDecay', type: 'select', label: 'Meter fall-off', def: 'medium', opts: O(['fast', 'Fast'], ['medium', 'Medium'], ['slow', 'Slow']) },
    { id: 'mxPeakHold', type: 'toggle', label: 'Hold peaks', def: true },
    { id: 'mxShowEmpty', type: 'toggle', label: 'Show unused inserts', def: true },
    { id: 'mxSlotsShown', type: 'select', label: 'Effect slots shown per strip', def: 10, opts: O(4, 6, 8, 10) },
  ] },
  { group: 'Export', icon: 'download', items: [
    { id: 'rBits', type: 'select', label: 'WAV bit depth', def: 24, opts: O([16, '16-bit'], [24, '24-bit'], [32, '32-bit float']) },
    { id: 'rRate', type: 'select', label: 'WAV sample rate', def: 44100, opts: O([22050, '22.05 kHz'], [44100, '44.1 kHz'], [48000, '48 kHz'], [96000, '96 kHz']) },
    { id: 'rTail', type: 'range', label: 'Tail after last note', def: 2, min: 0, max: 12, step: 0.5, fmt: v => v.toFixed(1) + ' s' },
    { id: 'rNormalize', type: 'toggle', label: 'Normalize to -0.3 dBFS', def: false },
    { id: 'rDither', type: 'toggle', label: 'Dither 16-bit exports', def: true },
    { id: 'rLimit', type: 'toggle', label: 'Apply master safety limiter in export', def: true },
  ] },
];

const KEY = 'beatforge.settings.v1';
let vals = {};
try { vals = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { vals = {}; }

const ev = new U.Emitter();
const defs = {};
SCHEMA.forEach(g => g.items.forEach(it => { defs[it.id] = it; }));

const Settings = DAW.settings = {
  schema: SCHEMA,
  def: id => defs[id],
  get(id) {
    if (id in vals) return vals[id];
    const d = defs[id];
    return d ? d.def : undefined;
  },
  set(id, v) {
    vals[id] = v;
    try { localStorage.setItem(KEY, JSON.stringify(vals)); } catch (_) { /* storage may be blocked */ }
    ev.emit(id, v);
    ev.emit('*', id, v);
  },
  reset() {
    vals = {};
    try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ }
    ev.emit('*', null, null);
  },
  on: (id, fn) => ev.on(id, fn),
  apply() {
    const root = document.documentElement;
    const acc = Settings.get('accent');
    root.style.setProperty('--acc', acc);
    root.style.setProperty('--acc-d', U.darken(acc, 0.35));
    root.style.setProperty('--acc-l', U.lighten(acc, 0.25));
    root.style.setProperty('--acc-a', U.rgba(acc, 0.18));
    root.style.setProperty('--ui', String(Settings.get('uiScale')));
    root.dataset.motion = Settings.get('reduceMotion') ? 'reduce' : 'full';
  },
};
ev.on('*', () => Settings.apply());
Settings.apply();

DAW.haptic = ms => {
  if (Settings.get('haptics') && navigator.vibrate) { try { navigator.vibrate(ms || 8); } catch (_) { /* unsupported */ } }
};
})();
