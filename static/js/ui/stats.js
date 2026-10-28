// Live statistics, line gutter, editor events and the selection menu.
import { state } from './state.js';
import { diagnose } from '../core/diagnostics.js';
import { markdownLineInfo } from '../core/structure.js';
import { renderDiagnose } from './diagnostics.js';
import { $, editor, gutter } from './dom.js';
import { handleTabIndent } from './editor-ops.js';
import { refreshFindMatches, syncFindHighlights } from './find.js';
import { scheduleLanguageDetection, typographyOptions, updateLanguageHint } from './language.js';
import { renderOutline } from './outline.js';
import { renderMarkdownPreview } from './preview.js';
import { scheduleAutosave } from './settings.js';
import { renderStructurePanel } from './structure-panel.js';

export function updateStats() {
  const text = editor.value;
  $('#statChars').textContent = text.length.toLocaleString();
  $('#statWords').textContent = (text.match(/\S+/g) || []).length.toLocaleString();
  $('#statLines').textContent = text.split('\n').length.toLocaleString();
  $('#statChapters').textContent = (text.match(/^\s{0,3}#\s+\S/gm) || []).length.toLocaleString();
  $('#statSubheads').textContent = (text.match(/^\s{0,3}#{2,6}\s+\S/gm) || []).length.toLocaleString();
  const diag = diagnose(text, typographyOptions());
  renderGutter(diag);
  renderDiagnose(diag);
  renderOutline();
  renderStructurePanel();
  renderMarkdownPreview();
  scheduleAutosave();
  scheduleLanguageDetection();
  updateLanguageHint();
}
document.addEventListener('mw:language-changed', () => updateStats());
function renderGutter(diag) {
  const lines = diag ? diag.lines : editor.value.split('\n');
  if (lines.length > 12000) {
    gutter.innerHTML = '<div class="gline">…</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (let i = 0; i < lines.length; i++) {
    const f = diag ? diag.flags[i] : new Set();
    const d = document.createElement('div');
    let cls = 'gline';
    const notes = [];
    if (f.has('mojibake') || f.has('invisible') || f.has('control') || f.has('specialSpace') || f.has('ligature')) {
      cls += ' issue-violet';
      notes.push('encoding/hidden character issue');
    } else if (f.has('trailingWs') || f.has('tabs') || f.has('extraBlank')) {
      cls += ' issue-rust';
      notes.push('spacing issue');
    } else if (f.has('wrap') || f.has('pageNum') || f.has('repeatLine')) {
      cls += ' issue-amber';
      notes.push('structure candidate');
    } else if (f.has('doubleSpace') || f.has('spaceBeforePunct') || f.has('apostrophe')) {
      cls += ' issue-blue';
      notes.push('typography spacing');
    } else if (markdownLineInfo(lines[i]) || /^\s*:::\s*[a-z0-9_-]*\s*$/i.test(lines[i])) cls += ' issue';
    d.className = cls;
    if (notes.length) d.title = notes.join(', ');
    d.textContent = i + 1;
    frag.appendChild(d);
  }
  gutter.innerHTML = '';
  gutter.appendChild(frag);
  gutter.scrollTop = editor.scrollTop;
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
