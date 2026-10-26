'use strict';
/* Beatforge — tiny IndexedDB key/value layer (falls back to memory when storage is blocked). */
(() => {
const DAW = window.DAW;
const STORES = ['projects', 'samples', 'kv'];
let dbp = null;
const mem = { projects: new Map(), samples: new Map(), kv: new Map() };
let broken = false;

function open() {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      const req = indexedDB.open('beatforge', 1);
      req.onupgradeneeded = () => { STORES.forEach(s => { if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { broken = true; resolve(null); };
      req.onblocked = () => { broken = true; resolve(null); };
    } catch (_) { broken = true; resolve(null); }
  });
  return dbp;
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

DAW.db = {
  async get(store, key) {
    const db = await open();
    if (!db) return mem[store].get(key);
    return reqP(db.transaction(store).objectStore(store).get(key));
  },
  async put(store, key, val) {
    const db = await open();
    if (!db) { mem[store].set(key, val); return; }
    await reqP(db.transaction(store, 'readwrite').objectStore(store).put(val, key));
  },
  async del(store, key) {
    const db = await open();
    if (!db) { mem[store].delete(key); return; }
    await reqP(db.transaction(store, 'readwrite').objectStore(store).delete(key));
  },
  async all(store) {
    const db = await open();
    if (!db) return Array.from(mem[store].entries()).map(([k, v]) => ({ key: k, val: v }));
    return new Promise((res, rej) => {
      const out = [];
      const r = db.transaction(store).objectStore(store).openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { out.push({ key: c.key, val: c.value }); c.continue(); } else res(out); };
      r.onerror = () => rej(r.error);
    });
  },
  get persistent() { return !broken; },
};
})();
