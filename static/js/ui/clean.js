// Clean tab operations.
import { state } from './state.js';
import { DESTRUCTIVE_FIXES, FIXES, FIX_LABELS, safeCleanup } from '../core/cleaning.js';
import { stripMarkers } from '../core/structure.js';
import { openPreview } from './ai-preview.js';
import { $, editor, toast } from './dom.js';
import { getScope, replaceRange } from './editor-ops.js';
import { typographyOptions } from './language.js';
import { snapshotBefore } from './project.js';

export function fixOptions() {
  return { dehyphenate: $('#dehyphenate')?.checked ?? true, ...typographyOptions() };
}
function buildFixResult(id) {
  const fn = FIXES[id];
  if (!fn) return null;
  const prev = editor.value;
  const opts = fixOptions();
  if (getScope() === 'selection') {
    const start = editor.selectionStart,
      end = editor.selectionEnd;
    if (start === end) {
      toast('Select some text first, or switch to Whole text.');
      return null;
    }
    const before = prev.slice(start, end);
    const after = fn(before, opts);
    return { id, before, after, start, end, title: FIX_LABELS[id] || id };
  }
  const fixed = fn(prev, opts);
  return { id, before: prev, after: fixed, start: 0, end: prev.length, title: FIX_LABELS[id] || id };
}
export function applyTextChange(before, after, start, end, label) {
  if (after === before) {
    toast('Nothing to change.');
    return;
  }
  if (start === 0 && end === editor.value.length)
    snapshotBefore(`Before ${String(label || 'Clean').replace(/ applied.*$/i, '')}`); // a whole-text change
  replaceRange(start, end, after);
  toast(label || 'Applied');
}
function showFixPreview(result) {
  openPreview(`Preview: ${result.title}`, result.before, result.after, result.start, result.end, false);
  $('#applyPreviewBtn').disabled = false;
  state.previewState.finished = true;
}
document.querySelectorAll('[data-fix]').forEach((btn) => {
  if (DESTRUCTIVE_FIXES.has(btn.dataset.fix)) btn.classList.add('destructive');
  btn.addEventListener('click', () => {
    const result = buildFixResult(btn.dataset.fix);
    if (!result) return;
    if (result.after === result.before) {
      toast('Nothing to change for this operation.');
      return;
    }
    if (DESTRUCTIVE_FIXES.has(btn.dataset.fix)) showFixPreview(result);
    else applyTextChange(result.before, result.after, result.start, result.end, FIX_LABELS[btn.dataset.fix]);
  });
});
$('#safeCleanupBtn').addEventListener('click', () => {
  if (getScope() === 'selection') {
    const start = editor.selectionStart,
      end = editor.selectionEnd;
    if (start === end) {
      toast('Select some text first, or switch to Whole text.');
      return;
    }
    const before = editor.value.slice(start, end);
    const after = safeCleanup(before, fixOptions());
    applyTextChange(before, after, start, end, 'Safe Cleanup applied to selection');
    return;
  }
  const before = editor.value;
  const after = safeCleanup(before, fixOptions());
  applyTextChange(before, after, 0, before.length, 'Safe Cleanup applied');
});
$('#showMarkersBtn').addEventListener('click', () =>
  openPreview('Clean text preview', editor.value, stripMarkers(editor.value), 0, editor.value.length, false),
);
