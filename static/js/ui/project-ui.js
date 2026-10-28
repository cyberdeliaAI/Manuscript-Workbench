// The project menu entries and the Projects and Snapshots dialogs.
import { state } from './state.js';
import { describeAge } from '../core/project.js';
import { $, editor, toast } from './dom.js';
import { openCompare } from './compare.js';
import {
  closeProject,
  deleteProjectById,
  deleteSnapshot,
  exportProjectFile,
  getSnapshot,
  importProjectFile,
  listProjects,
  listSnapshots,
  openProjectById,
  renderProjectStatus,
  requestNewProject,
  requestSaveAs,
  restoreSnapshot,
  saveProject,
  takeSnapshot,
} from './project.js';

// ---- projects dialog ----------------------------------------------------------------------------

async function openProjectsDialog() {
  $('#projectsModal').classList.add('open');
  await renderProjects();
}

async function renderProjects() {
  const list = $('#projectList');
  list.innerHTML = '<div class="empty-hint">Loading...</div>';
  let data;
  try {
    data = await listProjects();
  } catch (err) {
    list.innerHTML = '';
    toast(err.message);
    return;
  }
  $('#projectsDir').textContent = data.dir;
  list.innerHTML = '';
  if (!data.projects.length) {
    list.innerHTML =
      '<div class="empty-hint">No projects yet. Use "Save project as" to turn the text on screen into one.</div>';
    return;
  }
  for (const p of data.projects) {
    const row = document.createElement('div');
    row.className = 'merge-row';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'merge-name';
    name.textContent = p.name + (state.project?.id === p.id ? '  (open)' : '');
    const meta = document.createElement('div');
    meta.className = 'merge-meta';
    meta.textContent = `${p.words.toLocaleString()} words · ${p.snapshots} snapshot${p.snapshots === 1 ? '' : 's'} · saved ${describeAge(p.updatedAt)}`;
    info.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'merge-actions';
    actions.append(
      button('Open', async () => {
        if (await openProjectById(p.id)) $('#projectsModal').classList.remove('open');
      }),
      button('Delete', async () => {
        if (!confirm(`Delete the project "${p.name}"? It is moved to the .trash folder inside the projects folder.`))
          return;
        if (await deleteProjectById(p.id)) renderProjects();
      }),
    );
    row.append(info, actions);
    list.appendChild(row);
  }
}

function button(label, onClick, className = '') {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  if (className) el.className = className;
  el.addEventListener('click', onClick);
  return el;
}

// ---- snapshots dialog ---------------------------------------------------------------------------

async function openSnapshotsDialog() {
  if (!state.project) {
    toast('Snapshots belong to a project. Use "Save project as" first.');
    return;
  }
  $('#snapshotsModal').classList.add('open');
  $('#snapshotsTitle').textContent = `Snapshots of "${state.project.name}"`;
  $('#snapshotLabel').value = '';
  await renderSnapshots();
}

async function renderSnapshots() {
  const list = $('#snapshotList');
  list.innerHTML = '';
  let snapshots;
  try {
    snapshots = await listSnapshots();
  } catch (err) {
    toast(err.message);
    return;
  }
  const currentWords = state.analysis?.stats.words ?? 0;
  $('#snapshotSummary').textContent =
    `${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}. Automatic ones are made before AI changes, Replace All and imports; only the newest 50 are kept.`;
  if (!snapshots.length) {
    list.innerHTML = '<div class="empty-hint">No snapshots yet. Take one before a big edit.</div>';
    return;
  }
  for (const s of snapshots) {
    const row = document.createElement('div');
    row.className = 'merge-row';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'merge-name';
    const badge = document.createElement('span');
    badge.className = `badge ${s.kind}`;
    badge.textContent = s.kind === 'manual' ? 'MANUAL' : 'AUTO';
    name.append(badge, document.createTextNode(s.label || s.reason || '(no label)'));
    const delta = s.words - currentWords;
    const meta = document.createElement('div');
    meta.className = 'merge-meta';
    meta.textContent = `${describeAge(s.createdAt)} · ${s.words.toLocaleString()} words (${delta === 0 ? 'same length as now' : `${delta > 0 ? '+' : ''}${delta.toLocaleString()} vs now`})`;
    info.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'merge-actions';
    actions.append(
      button('Compare', async () => {
        try {
          const full = await getSnapshot(s.id);
          openCompare(
            full.text,
            editor.value,
            `Snapshot "${s.label || s.reason || s.id}" (left) against the text on screen (right).`,
          );
        } catch (err) {
          toast(err.message);
        }
      }),
      button('Restore', async () => {
        if (
          !confirm(
            'Replace the text on screen with this snapshot? What is on screen now is saved as a snapshot first, and Undo also works.',
          )
        )
          return;
        try {
          if (await restoreSnapshot(s.id)) {
            $('#snapshotsModal').classList.remove('open');
            saveProject({ silent: true });
          }
        } catch (err) {
          toast(err.message);
        }
      }),
      button('Delete', async () => {
        try {
          await deleteSnapshot(s.id);
          renderSnapshots();
        } catch (err) {
          toast(err.message);
        }
      }),
    );
    row.append(info, actions);
    list.appendChild(row);
  }
}

$('#snapshotTakeBtn').addEventListener('click', async () => {
  try {
    if (await takeSnapshot($('#snapshotLabel').value.trim())) {
      $('#snapshotLabel').value = '';
      renderSnapshots();
    }
  } catch (err) {
    toast(err.message);
  }
});
$('#snapshotLabel').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') $('#snapshotTakeBtn').click();
});
$('#snapshotsCloseBtn').addEventListener('click', () => $('#snapshotsModal').classList.remove('open'));
$('#projectsCloseBtn').addEventListener('click', () => $('#projectsModal').classList.remove('open'));
$('#projectsNewBtn').addEventListener('click', async () => {
  if (await requestNewProject()) $('#projectsModal').classList.remove('open');
});

// ---- menu ---------------------------------------------------------------------------------------

$('#projectNewBtn').addEventListener('click', requestNewProject);
$('#projectOpenBtn').addEventListener('click', openProjectsDialog);
$('#projectSaveBtn').addEventListener('click', () => saveProject());
$('#projectSaveAsBtn').addEventListener('click', requestSaveAs);
$('#projectSnapshotsBtn').addEventListener('click', openSnapshotsDialog);
$('#projectExportBtn').addEventListener('click', exportProjectFile);
$('#projectCloseBtn').addEventListener('click', closeProject);
$('#projectImportInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) await importProjectFile(file);
});
$('#projectStatus').addEventListener('click', () => {
  if (state.project) saveProject();
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveProject();
  }
});
renderProjectStatus();
