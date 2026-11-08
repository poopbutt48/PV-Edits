// App start-up: the "My projects" home screen, then the editor.
import { h, clear, toast, confirmDialog, timeAgo } from './dom.js';
import { Editor } from './editor.js';
import { TEMPLATES, createProjectFromTemplate } from './templates.js';
import { listProjects, loadProject, saveProject, deleteProject, openTextFile, validateProject, platformName } from './persistence.js';

const root = document.getElementById('app');
let editor = null;

async function showHome() {
  editor = null;
  clear(root);
  document.title = 'Sprout Engine';
  let projects = [];
  try { projects = await listProjects(); } catch (e) { toast(`Could not read saved projects: ${e.message}`, 'error'); }
  const list = h('div', { class: 'project-list' });
  if (!projects.length) list.appendChild(h('p', { class: 'muted' }, 'No projects yet - start one on the left!'));
  for (const p of projects) {
    list.appendChild(h('div', { class: 'project-card' },
      h('button', { class: 'project-open', 'data-ai': `project:${p.id}`, onclick: () => openProject(p.id) },
        h('span', { class: 'project-card-name' }, p.name),
        h('span', { class: 'muted small' }, `${p.scenes} scene${p.scenes === 1 ? '' : 's'} · edited ${timeAgo(p.modified)}`)),
      h('button', { class: 'icon-btn', title: 'Delete project', 'aria-label': `Delete ${p.name}`, onclick: async () => {
        if (await confirmDialog({ title: 'Delete project', message: `Delete "${p.name}" forever? This cannot be undone. (Tip: Save project file first to keep a copy.)`, okText: 'Delete', danger: true })) {
          await deleteProject(p.id);
          showHome();
        }
      } }, '🗑')));
  }
  const templates = h('div', { class: 'template-list' }, TEMPLATES.map((t) => h('button', {
    class: 'template-card', 'data-ai': `template:${t.id}`,
    onclick: async () => {
      const project = createProjectFromTemplate(t.id);
      await saveProject(project);
      openProject(project.id);
    },
  }, h('span', { class: 'template-icon' }, t.icon), h('span', { class: 'template-name' }, t.name), h('span', { class: 'muted small' }, t.summary))));

  root.appendChild(h('div', { class: 'home' },
    h('header', { class: 'home-header' },
      h('div', { class: 'home-logo' }, '🌱'),
      h('div', null, h('h1', null, 'Sprout Engine'), h('p', { class: 'muted' }, 'Make 2D games. Stuck? The AI helper can do it for you - and shows you how.'))),
    h('div', { class: 'home-cols' },
      h('section', null, h('h2', null, 'Start something new'), templates,
        h('button', { class: 'btn', onclick: importFile }, '📂 Open a project file…')),
      h('section', null, h('h2', null, 'My projects'), list)),
    h('footer', { class: 'home-footer muted small' }, `Running as: ${platformName().replace('-', ' ')} · Projects are saved on this device automatically.`)));
}

async function importFile() {
  const f = await openTextFile('.sprout,.json');
  if (!f) return;
  try {
    const p = validateProject(JSON.parse(f.text));
    await saveProject(p);
    openProject(p.id);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function openProject(id) {
  const p = await loadProject(id);
  if (!p) { toast('That project could not be found.', 'error'); showHome(); return; }
  document.title = `${p.name} - Sprout Engine`;
  editor = new Editor(root, p, {
    onExit: (openId) => { if (openId) openProject(openId); else showHome(); },
  });
  editor.mount();
  window.sprout = editor; // handy for debugging in the developer console
}

window.addEventListener('beforeunload', () => { if (editor) editor.saveNow(); });

const params = new URLSearchParams(location.search);
if (params.get('project')) openProject(params.get('project'));
else showHome();
