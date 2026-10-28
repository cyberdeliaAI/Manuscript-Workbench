// Live statistics, line gutter, editor events and the selection menu.
import { state } from './state.js';
import { scheduleAnalysis } from './analysis.js';
import { $, editor, gutter } from './dom.js';
import { handleTabIndent } from './editor-ops.js';
import { refreshFindMatches, syncFindHighlights } from './find.js';
import { updateLanguageHint } from './language.js';
import { markProjectDirty } from './project.js';
import { renderMarkdownPreview } from './preview.js';
import { scheduleAutosave } from './settings.js';

export function updateStats() {
  // Cheap on purpose: the heavy analysis runs in a worker after a pause in typing (see analysis.js).
  scheduleAnalysis();
  renderMarkdownPreview();
  scheduleAutosave();
  updateLanguageHint();
  markProjectDirty();
}
function syncScroll(source, target) {
  if (state.scrollSyncing || !target) return;
  state.scrollSyncing = true;
  const maxSource = Math.max(1, source.scrollHeight - source.clientHeight);
  const maxTarget = Math.max(0, target.scrollHeight - target.clientHeight);
  target.scrollTop = (source.scrollTop / maxSource) * maxTarget;
  requestAnimationFrame(() => {
    state.scrollSyncing = false;
  });
}
editor.addEventListener('scroll', () => {
  gutter.scrollTop = editor.scrollTop;
  syncFindHighlights();
  const pane = $('#markdownPreview');
  if (pane && document.querySelector('.editor-card')?.classList.contains('preview-on')) syncScroll(editor, pane);
});
$('#markdownPreview').addEventListener('scroll', () => {
  if (!document.querySelector('.editor-card')?.classList.contains('preview-on')) return;
  syncScroll($('#markdownPreview'), editor);
  gutter.scrollTop = editor.scrollTop;
});
editor.addEventListener('keydown', handleTabIndent);
editor.addEventListener('input', () => {
  updateStats();
  if ($('#findModal')?.classList.contains('open')) refreshFindMatches(editor.selectionStart);
});
editor.addEventListener('select', updateSelInfo);
editor.addEventListener('click', updateSelInfo);
editor.addEventListener('keyup', updateSelInfo);
editor.addEventListener('mouseup', updateSelInfo);
export function updateSelInfo() {
  const s = editor.selectionStart,
    e = editor.selectionEnd;
  $('#selInfo').textContent = s === e ? 'no selection' : `${(e - s).toLocaleString()} chars selected`;
  updateSelectionMenu();
}
export function updateSelectionMenu() {
  const menu = $('#selectionMenu');
  if (!menu) return;
  if ($('#findModal')?.classList.contains('open')) {
    menu.hidden = true;
    return;
  }
  const hasSelection = editor.selectionStart !== editor.selectionEnd && document.activeElement === editor;
  if (!hasSelection) {
    if (!menu.matches(':focus-within')) {
      menu.hidden = true;
      $('#selectionAction').value = '';
      state.savedSelection = null;
    }
    return;
  }
  state.savedSelection = { start: editor.selectionStart, end: editor.selectionEnd };
  const r = editor.getBoundingClientRect();
  menu.hidden = false;
  const width = Math.min(520, Math.max(320, r.width * 0.55));
  menu.style.width = width + 'px';
  menu.style.left = Math.max(10, Math.min(window.innerWidth - width - 10, r.right - width - 14)) + 'px';
  menu.style.top = Math.max(10, r.top + 10) + 'px';
}
document.addEventListener('selectionchange', () => {
  if (document.activeElement === editor) updateSelectionMenu();
});
