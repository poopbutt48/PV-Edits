// Small helpers for building the editor's interface.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Very small Markdown subset for AI messages: paragraphs, **bold**, `code`,
// ```code blocks``` and bullet / numbered lists.
export function miniMarkdown(text) {
  const blocks = String(text || '').split(/```/);
  let html = '';
  blocks.forEach((block, i) => {
    if (i % 2 === 1) {
      html += `<pre><code>${escapeHtml(block.replace(/^\w*\n/, ''))}</code></pre>`;
      return;
    }
    const lines = block.split('\n');
    let list = null;
    let para = [];
    const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
    const flushList = () => { if (list) { html += `<${list.type}>${list.items.map((x) => `<li>${inline(x)}</li>`).join('')}</${list.type}>`; list = null; } };
    for (const line of lines) {
      const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        flushPara();
        const type = ul ? 'ul' : 'ol';
        if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
        list.items.push((ul || ol)[1]);
      } else if (!line.trim()) {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(line.trim());
      }
    }
    flushPara();
    flushList();
  });
  return html;
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

// ------------------------------------------------------------ toasts

let toastBox = null;
export function toast(message, kind = 'info', ms = 3200) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(toastBox);
  }
  const t = h('div', { class: `toast toast-${kind}` }, message);
  toastBox.appendChild(t);
  setTimeout(() => { t.classList.add('toast-hide'); setTimeout(() => t.remove(), 300); }, ms);
}

// ------------------------------------------------------------ dialogs

// A modal dialog. `build(close)` returns the body element.
export function openDialog({ title, build, wide = false, ai = null, onClose = null }) {
  const backdrop = h('div', { class: 'dialog-backdrop' });
  const box = h('div', { class: `dialog ${wide ? 'dialog-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'data-ai': ai || undefined });
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
  const header = h('div', { class: 'dialog-header' },
    h('h2', null, title),
    h('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', 'data-ai': 'dialog-close', onclick: () => close(null) }, '✕'));
  box.append(header, build(close));
  backdrop.appendChild(box);
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(null); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  const first = box.querySelector('input,textarea,select');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, element: box };
}

export function promptDialog({ title, label, value = '', okText = 'OK', ai = 'prompt' }) {
  return new Promise((resolve) => {
    openDialog({
      title,
      ai: `${ai}-dialog`,
      onClose: (r) => resolve(r ?? null),
      build: (close) => {
        const input = h('input', { type: 'text', value, 'data-ai': `${ai}-input`, 'aria-label': label });
        const form = h('form', { class: 'dialog-body', onsubmit: (e) => { e.preventDefault(); close(input.value.trim() || null); } },
          h('label', { class: 'field-label' }, label),
          input,
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'),
            h('button', { type: 'submit', class: 'btn btn-primary', 'data-ai': `${ai}-ok` }, okText)));
        setTimeout(() => input.select(), 40);
        return form;
      },
    });
  });
}

export function confirmDialog({ title, message, okText = 'OK', danger = false, ai = 'confirm' }) {
  return new Promise((resolve) => {
    openDialog({
      title,
      ai: `${ai}-dialog`,
      onClose: (r) => resolve(!!r),
      build: (close) => h('div', { class: 'dialog-body' },
        h('p', null, message),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, 'data-ai': `${ai}-ok`, onclick: () => close(true) }, okText))),
    });
  });
}

// ------------------------------------------------------------ misc

export function debounce(fn, ms) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function rafThrottle(fn) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(); });
  };
}

export function isMobileLayout() {
  return window.matchMedia('(max-width: 900px)').matches;
}

export function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}
