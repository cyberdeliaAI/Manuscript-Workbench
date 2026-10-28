// Projects: open, save (also automatically), save as, close, export/import, and the snapshots that belong to them.
// The server keeps the files (see manuscript_workbench/project.py); this module keeps track of what is open.
import { state } from './state.js';
import { buildProject, buildProjectFile, parseProjectFile, projectFileName } from '../core/project.js';
import { DEFAULT_PROMPTS } from '../core/prompts.js';
import { api } from './api.js';
import { askName } from './dialogs.js';
import { setGlossaryText } from './glossary.js';
import { $, editor, filenameEl, toast } from './dom.js';
import { replaceRange } from './editor-ops.js';
import { downloadBlob } from './files.js';
import { applyProjectPrompts, getPrompts } from './prompts.js';
import { applyProjectSettings, getMetadata, getSettings, setMetadata } from './settings.js';
import { updateStats } from './stats.js';
import { storage } from './storage.js';
import { undoStack, updateUndoButton } from './undo.js';

const AUTOSAVE_MS = 3000;

class ProjectError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(action, body) {
  const res = await api(`/api/projects/${action}`, body);
  let data = {};
  try {
    data = await res.json();
  } catch (e) {}
  if (!res.ok) throw new ProjectError(data.error || `Request failed (${res.status})`, res.status, data.code || '');
  return data;
}

// ---- status in the header -----------------------------------------------------------------------

const STATUS_LABELS = {
  saved: 'saved',
  dirty: 'unsaved changes',
  saving: 'saving...',
  error: 'could not save',
  conflict: 'changed elsewhere',
};

export function renderProjectStatus() {
  const el = $('#projectStatus');
  const p = state.project;
  if (el) {
    el.className = `project-status${p ? ' ' + p.status : ''}`;
    el.textContent = p ? `${p.name} · ${STATUS_LABELS[p.status]}` : '';
    el.title = p ? `Project "${p.name}" (${p.id}.mwb.json)` : '';
  }
  for (const id of ['projectSnapshotsBtn', 'projectExportBtn', 'projectCloseBtn']) {
    const button = $('#' + id);
    if (button) button.disabled = id === 'projectExportBtn' ? false : !p;
  }
}

// ---- dirty tracking and autosave ----------------------------------------------------------------

let autosaveTimer = null;
let saving = null;

/** Called whenever the text, the metadata or anything else stored in the project changes. */
export function markProjectDirty() {
  const p = state.project;
  if (!p || state.projectLoading) return;
  state.projectVersion++;
  if (p.status !== 'conflict') p.status = 'dirty';
  renderProjectStatus();
  scheduleProjectAutosave();
}

function scheduleProjectAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (state.project?.status === 'dirty') saveProject({ silent: true });
  }, AUTOSAVE_MS);
}

function collectProject() {
  return buildProject({
    text: editor.value,
    metadata: getMetadata(),
    glossary: state.projectGlossary,
    ignoredCandidates: state.ignoredCandidates,
    prompts: getPrompts(),
    defaults: DEFAULT_PROMPTS,
    settings: getSettings(),
  });
}

let warnedAboutSaving = false;

/** Saves the open project (or asks for a name if there is none). Returns true when it is saved. */
export async function saveProject({ silent = false, force = false } = {}) {
  const p = state.project;
  if (!p) return silent ? false : requestSaveAs();
  if (saving) await saving.catch(() => {});
  const version = state.projectVersion;
  p.status = 'saving';
  renderProjectStatus();
  const run = (async () => {
    try {
      const data = await call('save', {
        id: p.id,
        name: p.name,
        project: collectProject(),
        baseUpdatedAt: p.updatedAt,
        force,
        periodicSnapshot: true,
      });
      p.updatedAt = data.saved.updatedAt;
      p.status = state.projectVersion === version ? 'saved' : 'dirty';
      if (p.status === 'dirty') scheduleProjectAutosave();
      warnedAboutSaving = false;
      return 'saved';
    } catch (err) {
      if (err.code === 'conflict') {
        p.status = 'conflict';
        return 'conflict';
      }
      p.status = 'error';
      if (!silent || !warnedAboutSaving) toast(`Could not save the project: ${err.message}`);
      warnedAboutSaving = true;
      return 'error';
    } finally {
      renderProjectStatus();
    }
  })();
  saving = run;
  let outcome;
  try {
    outcome = await run;
  } finally {
    saving = null;
  }
  if (outcome === 'conflict') {
    if (silent) {
      toast('This project was changed in another tab or window. Save it by hand to decide which version wins.');
      return false;
    }
    if (confirm('This project was changed in another tab or window. Replace that version with the one on screen?'))
      return saveProject({ force: true });
    return false;
  }
  if (outcome === 'saved' && !silent) toast('Project saved');
  return outcome === 'saved';
}

// ---- opening, creating, closing -----------------------------------------------------------------

function adopt(saved) {
  state.project = { id: saved.id, name: saved.name, updatedAt: saved.updatedAt, status: 'saved' };
  storage.set('lastProject', saved.id);
  renderProjectStatus();
}

async function createProject(name, project, { force = false } = {}) {
  try {
    const data = await call('save', { name, project, createOnly: !force, force });
    adopt(data.saved);
    return data.saved;
  } catch (err) {
    if (err.code === 'exists') {
      if (
        confirm(
          `A project named "${name}" already exists. Replace it with this version? (The old one is kept as a .bak file.)`,
        )
      )
        return createProject(name, project, { force: true });
      return null;
    }
    toast(err.message);
    return null;
  }
}

/** Saves what is on screen as a new project (also: "Save project as" for an open one). */
export async function requestSaveAs() {
  const suggestion = state.project?.name || getMetadata().title || '';
  const name = await askName({
    title: 'Save project as',
    label: 'Project name',
    value: suggestion,
    okLabel: 'Save',
    hint: 'The project is saved in the projects folder, with its snapshots.',
  });
  if (!name) return false;
  if (state.project && (state.project.status === 'dirty' || state.project.status === 'error'))
    await saveProject({ silent: true });
  const saved = await createProject(name, collectProject());
  if (saved) toast(`Saved as project "${saved.name}"`);
  return !!saved;
}

/** Makes sure whatever is open is safe on disk (or the author accepts losing it) before something replaces it. */
async function settleCurrent() {
  const p = state.project;
  if (p) {
    if (['dirty', 'error', 'saving'].includes(p.status)) {
      const ok = await saveProject({ silent: true });
      if (!ok && !confirm('The current project could not be saved. Continue anyway and lose its unsaved changes?'))
        return false;
    }
    return true;
  }
  if (editor.value.trim() && !confirm('Replace the current text? Use "Save project as" first if you want to keep it.'))
    return false;
  return true;
}

function applyProject(project) {
  state.projectLoading = true;
  try {
    editor.value = project.text;
    setMetadata(project.metadata);
    state.ignoredCandidates = project.ignoredCandidates || [];
    setGlossaryText(project.glossary || '');
    applyProjectPrompts(project.customPrompts);
    applyProjectSettings(project.settings);
    undoStack.length = 0;
    updateUndoButton();
    state.currentFilename = `${project.id}.md`;
    filenameEl.textContent = '';
    state.recoveryPending = false;
    $('#recovery')?.classList.remove('show');
    adopt(project);
    updateStats();
  } finally {
    state.projectLoading = false;
  }
  renderProjectStatus();
}

export async function openProjectById(id, { quiet = false } = {}) {
  if (state.project?.id === id) {
    if (!quiet) toast('That project is already open.');
    return true;
  }
  if (!quiet && !(await settleCurrent())) return false;
  try {
    const data = await call('open', { id });
    applyProject(data.project);
    if (!quiet) toast(`Opened project "${data.project.name}"`);
    return true;
  } catch (err) {
    if (err.code === 'not-found') storage.remove('lastProject');
    if (!quiet) toast(err.message);
    return false;
  }
}

export async function requestNewProject() {
  const name = await askName({
    title: 'New project',
    label: 'Project name',
    okLabel: 'Create',
    hint: 'An empty project in the projects folder.',
  });
  if (!name) return false;
  if (!(await settleCurrent())) return false;
  const saved = await createProject(
    name,
    buildProject({ text: '', metadata: {}, prompts: [], defaults: [], settings: {} }),
  );
  if (!saved) return false;
  state.project = null; // createProject adopted it; open it properly so the editor is cleared
  return openProjectById(saved.id, { quiet: true }).then((ok) => {
    if (ok) toast(`Created project "${saved.name}"`);
    return ok;
  });
}

export async function closeProject() {
  if (!state.project) return true;
  if (!(await settleCurrent())) return false;
  toast(`Closed project "${state.project.name}"`);
  state.project = null;
  storage.remove('lastProject');
  renderProjectStatus();
  return true;
}

export async function deleteProjectById(id) {
  try {
    await call('delete', { id });
  } catch (err) {
    toast(err.message);
    return false;
  }
  if (state.project?.id === id) {
    state.project = null;
    storage.remove('lastProject');
    renderProjectStatus();
  }
  return true;
}

export async function listProjects() {
  return call('list', {});
}

/** On startup: reopen the project that was open last time, if the editor is empty. */
export async function restoreLastProject() {
  const id = storage.get('lastProject');
  if (id && !editor.value) await openProjectById(id, { quiet: true });
  renderProjectStatus();
}

// ---- export and import --------------------------------------------------------------------------

export function exportProjectFile() {
  const name = state.project?.name || getMetadata().title || 'project';
  const file = buildProjectFile(name, collectProject());
  downloadBlob(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), projectFileName(name));
  toast('Project file exported');
}

export async function importProjectFile(file) {
  let parsed;
  try {
    parsed = parseProjectFile(await file.text());
  } catch (err) {
    toast(err.message);
    return false;
  }
  if (!(await settleCurrent())) return false;
  let name = parsed.name;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const data = await call('save', { name, project: parsed.project, createOnly: true });
      return openProjectById(data.saved.id, { quiet: true }).then((ok) => {
        if (ok) toast(`Imported project "${data.saved.name}"`);
        return ok;
      });
    } catch (err) {
      if (err.code !== 'exists') {
        toast(err.message);
        return false;
      }
      name = await askName({
        title: 'Import project file',
        label: `A project named "${name}" already exists. Name for the imported one`,
        value: `${name} (imported)`,
        okLabel: 'Import',
      });
      if (!name) return false;
    }
  }
  return false;
}

// ---- snapshots ----------------------------------------------------------------------------------

function openProjectOrExplain() {
  if (state.project) return state.project;
  toast('Snapshots belong to a project. Use "Save project as" first.');
  return null;
}

export async function listSnapshots() {
  const p = openProjectOrExplain();
  return p ? (await call('snapshots/list', { id: p.id })).snapshots : [];
}

export async function takeSnapshot(label) {
  const p = openProjectOrExplain();
  if (!p) return null;
  const data = await call('snapshots/create', { id: p.id, text: editor.value, kind: 'manual', label });
  toast('Snapshot saved');
  return data.snapshot;
}

export async function getSnapshot(snapshotId) {
  const p = openProjectOrExplain();
  return p ? (await call('snapshots/get', { id: p.id, snapshotId })).snapshot : null;
}

export async function deleteSnapshot(snapshotId) {
  const p = openProjectOrExplain();
  if (p) await call('snapshots/delete', { id: p.id, snapshotId });
}

/** Replaces the text with a snapshot. The text it replaces is snapshotted first, and the change can be undone. */
export async function restoreSnapshot(snapshotId) {
  const p = openProjectOrExplain();
  if (!p) return false;
  const data = await call('snapshots/restore', { id: p.id, snapshotId, currentText: editor.value });
  replaceRange(0, editor.value.length, data.text);
  editor.setSelectionRange(0, 0);
  toast('Snapshot restored (the previous text was saved as a snapshot too)');
  return true;
}

/**
 * An automatic restore point right before something replaces text (an AI rewrite, Replace All, an import ...).
 * It does nothing without an open project. The text is read now, so it can be called without waiting.
 */
export async function snapshotBefore(reason) {
  const p = state.project;
  if (!p || state.projectLoading) return;
  const text = editor.value;
  if (!text.trim()) return;
  try {
    await call('snapshots/create', { id: p.id, text, kind: 'auto', reason });
  } catch (err) {
    console.warn('The automatic snapshot failed:', err.message);
  }
}

window.addEventListener('beforeunload', (event) => {
  if (state.project && ['dirty', 'saving', 'error', 'conflict'].includes(state.project.status)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
