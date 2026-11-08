// Saves projects inside the app (IndexedDB), and to/from files.
// Works in a browser, in the Windows app (Electron) and in the Android app.

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const DB_NAME = 'sprout-engine';
const STORE = 'projects';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export async function saveProject(project) {
  const copy = JSON.parse(JSON.stringify(project));
  copy.modified = Date.now();
  await tx('readwrite', (s) => req(s.put(copy)));
  return copy.modified;
}

export async function loadProject(id) {
  return tx('readonly', (s) => req(s.get(id)));
}

export async function listProjects() {
  const all = await tx('readonly', (s) => req(s.getAll()));
  return (all || [])
    .map((p) => ({ id: p.id, name: p.name, modified: p.modified, scenes: (p.sceneOrder || []).length, thumb: p.thumb || null }))
    .sort((a, b) => b.modified - a.modified);
}

export async function deleteProject(id) {
  return tx('readwrite', (s) => req(s.delete(id)));
}

// ------------------------------------------------------------ files

const native = () => globalThis.sproutNative || null; // provided by the Windows app
const isAndroidApp = () => Capacitor.isNativePlatform();

export function platformName() {
  if (native()) return 'desktop-app';
  if (isAndroidApp()) return 'android-app';
  return 'browser';
}

export async function saveTextFile(suggestedName, text, kind = 'project') {
  const n = native();
  if (n) return n.saveFile({ suggestedName, text, kind });
  if (isAndroidApp()) {
    // Write to the app's cache, then let the person choose where it goes (Drive, Files, email…).
    const res = await Filesystem.writeFile({ path: suggestedName, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    try { await Share.share({ title: suggestedName, url: res.uri }); } catch (_) { /* closed the share sheet */ }
    return { saved: true, path: suggestedName };
  }
  const blob = new Blob([text], { type: kind === 'game' ? 'text/html' : 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return { saved: true, path: suggestedName };
}

export async function openTextFile(accept = '.sprout,.json') {
  const n = native();
  if (n) return n.openFile({ accept });
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, text: String(r.result) });
      r.readAsText(f);
    };
    input.click();
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function pickFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files || [])]);
    input.click();
  });
}

export function validateProject(p) {
  if (!p || p.format !== 'sprout-project') throw new Error('This file is not a Sprout project.');
  if (!p.scenes || !p.sceneOrder || !p.scripts || !p.assets) throw new Error('This project file is damaged (missing parts).');
  return p;
}
