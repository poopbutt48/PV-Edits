/* Beatforge smoke test — needs `npm i playwright` (or a global Playwright) and a Chromium build.
   Usage: node tests/smoke.js   (serves ./ on a random port, drives the real UI, renders audio offline) */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(root, req.url.split('?')[0].replace(/^\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); } });
});
const results = [];
const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://localhost:' + server.address().port + '/index.html';
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/sw\.js|404/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await p.goto(url); await p.waitForTimeout(600);
  const ev = f => p.evaluate(f);
  const notes = () => ev(() => DAW.state.notesOf(DAW.state.curPat(), DAW.state.curCh().id).map(n => ({ t: n.t, d: n.d, k: n.k })));

  // ---- audio engine: every template, effect and instrument renders finite, non-silent audio
  const eng = await ev(async () => {
    const D = DAW, S = D.state, out = {};
    const stats = buf => { let pk = 0, e = 0, nan = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i]; if (v !== v) nan++; const a = Math.abs(v); if (a > pk) pk = a; e += v * v; } } return { pk, rms: Math.sqrt(e / (buf.length * buf.numberOfChannels)), nan }; };
    for (const t of ['house', 'trap', 'lofi']) { S.newProject(t); out['template ' + t] = stats(await D.render({ mode: 'song', tail: 0.5 })); }
    S.newProject('house'); S.p.mode = 'pattern';
    for (const type of D.fx.order) { const tr = S.p.mixer.tracks[S.p.channels[0].mix]; tr.fx[0] = S.newFx(type); out['fx ' + type] = stats(await D.render({ mode: 'pattern', tail: 0.3 })); tr.fx[0] = null; }
    for (const type of ['synth', 'fm', 'pluck', 'drum', 'sampler']) {
      S.newProject('empty'); S.p.channels.forEach(c => S.removeChannel(c.id));
      const ch = S.addChannel(type, { sample: type === 'sampler' ? 'f:kick808' : null }), pat = S.addPattern('t');
      S.addNote(pat, ch.id, { t: 0, d: 96, k: 60, v: 100 });
      out['instrument ' + type] = stats(await D.render({ mode: 'pattern', tail: 0.3 }));
    }
    return out;
  });
  for (const [k, v] of Object.entries(eng)) ok('render ' + k, v.nan === 0 && v.rms > 0.003 && v.pk < 4, { rms: +v.rms.toFixed(3), peak: +v.pk.toFixed(2) });
  await ev(() => { DAW.state.newProject('empty'); });
  // ---- rack drag paint with mouse
  await p.waitForTimeout(200);
  const r0 = await p.locator('.ch-row').nth(2).locator('.step').nth(0).boundingBox();
  const r5 = await p.locator('.ch-row').nth(2).locator('.step').nth(5).boundingBox();
  await p.mouse.move(r0.x + 10, r0.y + 10); await p.mouse.down(); await p.mouse.move(r5.x + 10, r5.y + 10, { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(150);
  const painted = await ev(() => { const S = DAW.state, ch = S.p.channels[2]; return [0,1,2,3,4,5,6].map(i => S.stepOn(S.curPat(), ch.id, i).length); });
  ok('rack drag-paint 6 steps', painted.slice(0, 6).every(x => x === 1) && painted[6] === 0, painted);

  // ---- piano roll
  await p.click('.nav-b[data-view="piano"]'); await p.waitForTimeout(400);
  const ed = await p.locator('#v-piano .ed').boundingBox();
  await ev(() => { DAW.state.ui.ch = DAW.state.p.channels[0].id; DAW.state.emit('select'); });
  await p.waitForTimeout(100);
  // clear then draw by drag
  await ev(() => { const S = DAW.state; S.curPat().notes = {}; S.emit('notes'); });
  const x0 = ed.x + 140, y0 = ed.y + 200;
  await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x0 + 90, y0, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(150);
  let ns = await notes();
  ok('draw+drag creates a longer note', ns.length === 1 && ns[0].d > 24, ns);
  // move the note up one octave-ish by dragging
  const midX = x0 + 20;
  await p.mouse.move(midX, y0 + 4); await p.mouse.down(); await p.mouse.move(midX + 40, y0 - 60, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(150);
  const ns2 = await notes();
  ok('drag moves note in time and pitch', ns2.length === 1 && ns2[0].k > ns[0].k && ns2[0].t > ns[0].t, ns2);
  // resize by dragging right edge
  const nx = ns2[0], rEdge = await ev(() => { const pr = DAW.ui.pr, n = DAW.state.notesOf(DAW.state.curPat(), DAW.state.curCh().id)[0]; const KW = 58, RH = 26; return { x: KW + (n.t + n.d - pr.ox) * pr.zx, y: RH + (127 - n.k) * pr.rh - pr.oy + pr.rh / 2 }; });
  await p.mouse.move(ed.x + rEdge.x - 4, ed.y + rEdge.y); await p.mouse.down(); await p.mouse.move(ed.x + rEdge.x + 60, ed.y + rEdge.y, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
  const ns3 = await notes();
  ok('right-edge resize lengthens', ns3[0].d > ns2[0].d, [ns2[0].d, ns3[0].d]);
  // select tool + marquee + transpose
  await p.locator('#v-piano .tool[title="Select"]').click();
  await p.mouse.move(ed.x + 70, ed.y + 40); await p.mouse.down(); await p.mouse.move(ed.x + 400, ed.y + 400, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
  const selN = await ev(() => DAW.ui.pr.sel.size);
  ok('marquee selects the note', selN === 1, selN);
  
  await p.locator('#v-piano .lane-bar .ibtn[aria-label="Transpose up"]').click(); await p.waitForTimeout(100);
  const ns4 = await notes();
  ok('transpose up one semitone', ns4[0].k === ns3[0].k + 1, [ns3[0].k, ns4[0].k]);
  // pinch zoom via synthetic pointers
  const zx0 = await ev(() => DAW.ui.pr.zx);
  await ev(() => {
    const el = document.querySelector('#v-piano .ed canvas.over'), r = el.getBoundingClientRect();
    const mk = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 1 }));
    mk('pointerdown', 1, 150, 200); mk('pointerdown', 2, 250, 200);
    for (let i = 1; i <= 6; i++) { mk('pointermove', 1, 150 - i * 15, 200); mk('pointermove', 2, 250 + i * 15, 200); }
    mk('pointerup', 1, 60, 200); mk('pointerup', 2, 340, 200);
  });
  await p.waitForTimeout(100);
  const zx1 = await ev(() => DAW.ui.pr.zx);
  ok('two-finger pinch zooms in', zx1 > zx0 * 1.5, [zx0, zx1]);
  // lane edit changes velocity
  const lane = await p.locator('#v-piano .lane').boundingBox();
  const nxp = await ev(() => { const pr = DAW.ui.pr, n = DAW.state.notesOf(DAW.state.curPat(), DAW.state.curCh().id)[0]; return 58 + (n.t - pr.ox) * pr.zx; });
  const v0 = await ev(() => DAW.state.notesOf(DAW.state.curPat(), DAW.state.curCh().id)[0].v);
  await p.mouse.move(lane.x + nxp + 1, lane.y + 90); await p.mouse.down(); await p.mouse.move(lane.x + nxp + 1, lane.y + 40, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(100);
  const v1 = await ev(() => DAW.state.notesOf(DAW.state.curPat(), DAW.state.curCh().id)[0].v);
  ok('velocity lane drag changes velocity', v1 !== v0, [v0, v1]);

  // ---- playlist
  await ev(() => { const S = DAW.state; S.p.playlist.clips = []; S.emit('playlist'); });
  await p.click('.nav-b[data-view="playlist"]'); await p.waitForTimeout(400);
  const pe = await p.locator('#v-playlist .ed').boundingBox();
  await p.mouse.click(pe.x + 300, pe.y + 100); await p.waitForTimeout(150);
  let clips = await ev(() => DAW.state.p.playlist.clips.map(c => ({ t: c.t, d: c.d, track: c.track })));
  ok('click places a pattern clip on the grid', clips.length === 1 && clips[0].t % 384 === 0, clips);
  const cx = pe.x + 84 + (clips[0].t) * 0.2 + 36, cy = pe.y + 28 + clips[0].track * 56 + 28;
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + 160, cy + 60, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
  const clips2 = await ev(() => DAW.state.p.playlist.clips.map(c => ({ t: c.t, d: c.d, track: c.track })));
  ok('drag moves clip across bars and tracks', clips2[0].t > clips[0].t && clips2[0].track > clips[0].track, clips2);
  
  // loop region by ruler drag
  await p.mouse.move(pe.x + 200, pe.y + 14); await p.mouse.down(); await p.mouse.move(pe.x + 380, pe.y + 14, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
  const loop = await ev(() => ({ on: DAW.state.p.playlist.loopOn, a: DAW.state.p.playlist.loopStart, b: DAW.state.p.playlist.loopEnd }));
  ok('ruler drag sets loop region', loop.on && loop.b > loop.a, loop);

  // ---- mixer fader + knob drag
  await p.click('.nav-b[data-view="mixer"]'); await p.waitForTimeout(400);
  const fd = await p.locator('.strip').nth(1).locator('.fader').boundingBox();
  await p.mouse.move(fd.x + fd.width / 2, fd.y + fd.height * 0.4); await p.mouse.down(); await p.mouse.move(fd.x + fd.width / 2, fd.y + fd.height * 0.2, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(150);
  const vol = await ev(() => DAW.state.p.mixer.tracks[1].vol);
  ok('fader drag raises track volume', vol > 0.85, vol);
  // add effect through UI & route
  await p.locator('.fx-slot.empty').first().click(); await p.waitForTimeout(300);
  await p.locator('.sheet .br-item', { hasText: 'Compressor' }).first().click(); await p.waitForTimeout(300);
  const fxn = await ev(() => DAW.state.p.mixer.tracks[DAW.state.ui.track].fx.filter(Boolean).map(f => f.type));
  ok('add compressor via picker', fxn.includes('comp'), fxn);
  

  // ---- full song render through UI function + MIDI roundtrip + bundle
  const rend = await ev(async () => {
    DAW.state.newProject('house');
    const buf = await DAW.render({ mode: 'song', tail: 0.5 });
    const wav = DAW.wav.encode(buf, 16, {});
    const mid = DAW.midi.exportSMF('song');
    const before = DAW.state.p.channels.length;
    const res = DAW.midi.importSMF(mid.buffer, 'roundtrip');
    const blob = await DAW.bundle.export();
    return { sec: buf.duration, wavBytes: wav.byteLength, riff: new TextDecoder().decode(new Uint8Array(wav, 0, 4)), midBytes: mid.length, mthd: new TextDecoder().decode(mid.slice(0, 4)), imported: res.channels, before, after: DAW.state.p.channels.length, bundle: blob.size };
  });
  ok('render + WAV header', rend.riff === 'RIFF' && rend.sec > 10, rend);
  ok('MIDI export/import roundtrip creates channels', rend.mthd === 'MThd' && rend.imported >= 3, rend);

  // ---- settings take effect
  await ev(() => DAW.settings.set('uiScale', 1.3));
  const fs = await ev(() => getComputedStyle(document.documentElement).fontSize);
  ok('UI scale setting changes root font size', fs === '19.5px', fs);
  await ev(() => DAW.settings.set('uiScale', 1));
  console.log(results.join('\n')); console.log('Console/page errors:', errs.length ? errs : 'none');
  await b.close(); server.close();
  process.exit(results.some(r => r.startsWith('FAIL')) || errs.length ? 1 : 0);
})();
