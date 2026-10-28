// Side tabs, header menu, modals and view toggles.
import { state } from './state.js';
import { $, editor } from './dom.js';
import { syncFindHighlights } from './find.js';
import { renderGutterWindow } from './gutter.js';
import { renderMarkdownPreview } from './preview.js';
import { saveSettings } from './settings.js';
import { storage } from './storage.js';

export function activateSideTab(name) {
  document.querySelectorAll('[data-side-tab]').forEach((b) => b.classList.toggle('active', b.dataset.sideTab === name));
  document
    .querySelectorAll('[data-side-panel]')
    .forEach((p) => p.classList.toggle('active', p.dataset.sidePanel === name));
  storage.set('sideTab', name);
}
document
  .querySelectorAll('[data-side-tab]')
  .forEach((btn) => btn.addEventListener('click', () => activateSideTab(btn.dataset.sideTab)));
$('#wrapToggle').addEventListener('change', () => {
  const on = $('#wrapToggle').checked;
  editor.classList.toggle('wrap', on);
  $('#editorArea').classList.toggle('wrap', on);
  editor.setAttribute('wrap', on ? 'soft' : 'off');
  renderGutterWindow();
  syncFindHighlights();
  saveSettings();
});
$('#togglePreview').addEventListener('click', () => {
  const card = document.querySelector('.editor-card');
  const on = !card.classList.contains('preview-on');
  card.classList.toggle('preview-on', on);
  $('#togglePreview').classList.toggle('active', on);
  renderMarkdownPreview();
  saveSettings();
});
document.querySelectorAll('input[name="scope"]').forEach((input) => input.addEventListener('change', saveSettings));
$('#toggleStructureTools').addEventListener('click', () => {
  const tb = $('#structureToolbar');
  tb.classList.toggle('collapsed');
  $('#toggleStructureTools').textContent = tb.classList.contains('collapsed') ? 'Expand' : 'Collapse';
  saveSettings();
});
$('#aboutBtn').addEventListener('click', () => $('#aboutModal').classList.add('open'));
$('#closeAboutBtn').addEventListener('click', () => $('#aboutModal').classList.remove('open'));
$('.menu-panel').addEventListener('click', (e) => e.stopPropagation());
document.querySelectorAll('#headerMenu .menu-panel button,#headerMenu .menu-panel .btn').forEach((el) =>
  el.addEventListener('click', () => {
    if (el.id !== 'undoBtn') setTimeout(() => $('#headerMenu').removeAttribute('open'), 0);
  }),
);
document.querySelectorAll('.modal').forEach((modal) =>
  modal.addEventListener('mousedown', (e) => {
    if (e.target !== modal) return;
    if (modal.id === 'previewModal' && state.previewState.running) return;
    modal.classList.remove('open');
  }),
);
