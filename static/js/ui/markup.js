// Structure marking, inline formatting, quick actions and the selection menu actions.
import { state } from './state.js';
import { safeCleanup } from '../core/cleaning.js';
import { inlineWrapper, unwrapInlineText } from '../core/inline-markup.js';
import { MD_BLOCK_MARKERS, MD_PREFIX_MARKERS, isPartHeadingText, stripStructureLine } from '../core/structure.js';
import { startLM } from './ai.js';
import { applyTextChange, fixOptions } from './clean.js';
import { $, editor, toast } from './dom.js';
import { replaceRange, selectedLineRange } from './editor-ops.js';
import { updateSelectionMenu } from './stats.js';

function markLines(marker) {
  const r = selectedLineRange();
  const block = editor.value.slice(r.start, r.end);
  if (MD_PREFIX_MARKERS[marker]) {
    const prefix = MD_PREFIX_MARKERS[marker];
    const lines = block.split('\n').map((line) => {
      if (!line.trim()) return marker === 'quote' ? '>' : line;
      let content = stripStructureLine(line).replace(/^\s+/, '');
      if (marker === 'part' && !isPartHeadingText(content)) content = `Part ${content}`;
      return prefix + content;
    });
    replaceRange(r.start, r.end, lines.join('\n'));
    toast(`Marked as ${marker}`);
    return;
  }
  if (MD_BLOCK_MARKERS.has(marker)) {
    const body = block
      .split('\n')
      .filter((line) => !/^\s*:::\s*[a-z0-9_-]*\s*$/i.test(line))
      .map(stripStructureLine)
      .join('\n')
      .trim();
    const wrapped = `::: ${marker}\n${body || ''}\n:::`;
    replaceRange(r.start, r.end, wrapped);
    toast(`Marked as ${marker}`);
  }
}
document
  .querySelectorAll('[data-marker]')
  .forEach((btn) => btn.addEventListener('click', () => markLines(btn.dataset.marker)));
document.querySelectorAll('[data-insert]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const insert = '***';
    const pos = editor.selectionStart;
    replaceRange(pos, pos, (pos && editor.value[pos - 1] != '\n' ? '\n' : '') + insert + '\n');
  }),
);
document
  .querySelectorAll('[data-inline]')
  .forEach((btn) => btn.addEventListener('click', () => applyInline(btn.dataset.inline)));
function clearStructureMark() {
  const r = selectedLineRange();
  const block = editor.value.slice(r.start, r.end);
  const cleared = block
    .split('\n')
    .filter((line) => !/^\s*:::\s*[a-z0-9_-]*\s*$/i.test(line))
    .map(stripStructureLine)
    .join('\n');
  if (cleared === block) {
    toast('No structure marker on selected/current line.');
    return;
  }
  replaceRange(r.start, r.end, cleared);
  toast('Structure marker removed');
}
$('#clearStructureBtn').addEventListener('click', clearStructureMark);
function countEditorChars(pos, char, dir) {
  let n = 0,
    i = dir < 0 ? pos - 1 : pos;
  while (i >= 0 && i < editor.value.length && editor.value[i] === char) {
    n++;
    i += dir;
  }
  return n;
}
function unwrapAdjacentInline(start, end, kind) {
  const w = inlineWrapper(kind),
    val = editor.value;
  const beforeStart = start - w.prefix.length,
    afterEnd = end + w.suffix.length;
  if (beforeStart < 0 || afterEnd > val.length) return false;
  if (val.slice(beforeStart, start) !== w.prefix || val.slice(end, afterEnd) !== w.suffix) return false;
  if (kind === 'italic' && countEditorChars(start, '*', -1) === 2 && countEditorChars(end, '*', 1) === 2) return false;
  replaceRange(beforeStart, afterEnd, val.slice(start, end));
  return true;
}
function applyInline(kind) {
  const s = editor.selectionStart,
    e = editor.selectionEnd;
  if (s === e) {
    toast('Select text first.');
    return;
  }
  const sel = editor.value.slice(s, e);
  const unwrapped = unwrapInlineText(sel, kind);
  if (unwrapped !== null) {
    replaceRange(s, e, unwrapped);
    return;
  }
  if (unwrapAdjacentInline(s, e, kind)) return;
  let out;
  if (kind === 'mono') out = '`' + sel.replace(/`/g, '') + '`';
  else {
    const w = inlineWrapper(kind);
    out = w.prefix + sel + w.suffix;
  }
  replaceRange(s, e, out);
}
function restoreSavedSelection() {
  if (state.savedSelection) {
    editor.focus();
    editor.setSelectionRange(state.savedSelection.start, state.savedSelection.end);
  }
}
function restoreSelectionForQuickAction() {
  if (state.savedSelection) {
    restoreSavedSelection();
  } else {
    editor.focus();
  }
}
function applyQuickStyle(marker) {
  restoreSelectionForQuickAction();
  if (marker === 'normal') clearStructureMark();
  else if (marker) markLines(marker);
  $('#quickStyle').value = '';
  updateSelectionMenu();
}
function applyQuickIcon(icon) {
  if (!icon) return;
  restoreSelectionForQuickAction();
  const s = editor.selectionStart,
    e = editor.selectionEnd,
    sel = editor.value.slice(s, e);
  replaceRange(s, e, `${icon} ${sel}`);
  $('#quickIcon').value = '';
  updateSelectionMenu();
}
$('#quickStyle').addEventListener('change', () => applyQuickStyle($('#quickStyle').value));
$('#quickIcon').addEventListener('change', () => applyQuickIcon($('#quickIcon').value));
document.querySelectorAll('[data-quick-inline]').forEach((btn) => {
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    restoreSelectionForQuickAction();
    applyInline(btn.dataset.quickInline);
    updateSelectionMenu();
  });
});
$('#quickQuote').addEventListener('mousedown', (e) => e.preventDefault());
$('#quickQuote').addEventListener('click', () => {
  restoreSelectionForQuickAction();
  markLines('quote');
  updateSelectionMenu();
});
$('#quickAiRewrite').addEventListener('mousedown', (e) => e.preventDefault());
$('#quickAiRewrite').addEventListener('click', () => {
  restoreSelectionForQuickAction();
  startLM('rewrite', 'selection', false);
});
$('#quickAiClean').addEventListener('mousedown', (e) => e.preventDefault());
$('#quickAiClean').addEventListener('click', () => {
  restoreSelectionForQuickAction();
  startLM('clean', 'selection', false);
});
$('#quickClearMark').addEventListener('mousedown', (e) => e.preventDefault());
$('#quickClearMark').addEventListener('click', () => {
  restoreSelectionForQuickAction();
  clearStructureMark();
  updateSelectionMenu();
});
function runSelectionAction() {
  const action = $('#selectionAction').value;
  if (!action) return;
  restoreSavedSelection();
  if (action === 'ai-rewrite') startLM('rewrite', 'selection', false);
  else if (action === 'ai-clean') startLM('clean', 'selection', false);
  else if (action.startsWith('mark-')) markLines(action.slice(5));
  else if (action === 'clear-structure') clearStructureMark();
  else if (action.startsWith('inline-')) applyInline(action.slice(7));
  else if (action === 'safe-clean') {
    const start = editor.selectionStart,
      end = editor.selectionEnd;
    if (start === end) {
      toast('Select text first.');
      return;
    }
    const before = editor.value.slice(start, end);
    const after = safeCleanup(before, fixOptions());
    applyTextChange(before, after, start, end, 'Safe Cleanup applied to selection');
  }
  $('#selectionAction').value = '';
  state.savedSelection = null;
  $('#selectionMenu').hidden = true;
}
$('#selectionRunBtn').addEventListener('click', runSelectionAction);
$('#selectionAction').addEventListener('change', runSelectionAction);
