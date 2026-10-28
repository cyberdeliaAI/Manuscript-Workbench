// Find / Replace.
import { state } from './state.js';
import { escapeHtml, escapeRegExp } from '../core/text-utils.js';
import { $, editor, toast } from './dom.js';
import { snapshotBefore } from './project.js';
import { restoreEditorScroll, scrollEditorToOffset } from './editor-ops.js';
import { updateSelInfo, updateStats } from './stats.js';
import { pushUndoSnapshot } from './undo.js';

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    openFindModal();
  } else if (e.key === 'Escape' && $('#findModal')?.classList.contains('open')) closeFindModal();
});
$('#openFindBtn').addEventListener('click', openFindModal);
$('#closeFindBtn').addEventListener('click', closeFindModal);
$('#findNextBtn').addEventListener('click', () => findMove(1));
$('#findPrevBtn').addEventListener('click', () => findMove(-1));
$('#replaceOneBtn').addEventListener('click', replaceCurrentFind);
$('#replaceAllBtn').addEventListener('click', replaceAllFind);
['findText', 'replaceText'].forEach((id) =>
  $('#' + id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findMove(e.shiftKey ? -1 : 1);
    }
  }),
);
['findText', 'findRegex', 'findCase'].forEach((id) =>
  $('#' + id).addEventListener('input', () => refreshFindMatches(editor.selectionEnd)),
);
$('#findScope').addEventListener('change', () => {
  if ($('#findScope').value === 'selection') {
    state.findScopeRange =
      editor.selectionStart !== editor.selectionEnd
        ? { start: editor.selectionStart, end: editor.selectionEnd }
        : state.findScopeRange;
  } else state.findScopeRange = null;
  refreshFindMatches(editor.selectionEnd);
});
export function syncFindHighlights() {
  const layer = $('#findHighlights');
  if (!layer || !layer.classList.contains('show')) return;
  const area = $('#editorArea').getBoundingClientRect(),
    r = editor.getBoundingClientRect();
  layer.style.left = r.left - area.left + 'px';
  layer.style.top = r.top - area.top + 'px';
  layer.style.width = editor.clientWidth + 'px';
  layer.style.height = editor.clientHeight + 'px';
  layer.classList.toggle('wrap', editor.classList.contains('wrap'));
  layer.scrollTop = editor.scrollTop;
  layer.scrollLeft = editor.scrollLeft;
}
function hideFindHighlights() {
  const layer = $('#findHighlights');
  if (layer) {
    layer.classList.remove('show');
    layer.innerHTML = '';
  }
}
function renderFindHighlights() {
  const layer = $('#findHighlights');
  if (!layer) return;
  if (!$('#findModal')?.classList.contains('open') || !state.findMatches.length) {
    hideFindHighlights();
    return;
  }
  const text = editor.value;
  let html = '',
    pos = 0;
  state.findMatches.forEach((m, idx) => {
    if (m.start < pos) return;
    html += escapeHtml(text.slice(pos, m.start));
    html += `<span class="find-hit ${idx === state.findIndex ? 'current' : ''}">${escapeHtml(text.slice(m.start, m.end))}</span>`;
    pos = m.end;
  });
  html += escapeHtml(text.slice(pos));
  layer.innerHTML = html || '&nbsp;';
  layer.classList.add('show');
  syncFindHighlights();
}
function findOptions() {
  return {
    pattern: $('#findText').value,
    replacement: $('#replaceText').value,
    regex: $('#findRegex').checked,
    caseSensitive: $('#findCase').checked,
    scope: $('#findScope').value,
  };
}
function findRange() {
  const opts = findOptions();
  if (opts.scope === 'selection') {
    if (!state.findScopeRange || state.findScopeRange.start === state.findScopeRange.end) {
      return null;
    }
    return { start: state.findScopeRange.start, end: Math.min(state.findScopeRange.end, editor.value.length) };
  }
  return { start: 0, end: editor.value.length };
}
function buildFindRegex(global = true) {
  const opts = findOptions();
  if (!opts.pattern) {
    $('#findStatus').textContent = 'Enter text to find.';
    return null;
  }
  const source = opts.regex ? opts.pattern : escapeRegExp(opts.pattern);
  const flags = (global ? 'g' : '') + (opts.caseSensitive ? '' : 'i');
  try {
    return new RegExp(source, flags);
  } catch (err) {
    $('#findStatus').textContent = `Regex error: ${err.message}`;
    return null;
  }
}
export function refreshFindMatches(anchor = null) {
  const range = findRange();
  const re = buildFindRegex(true);
  state.findMatches = [];
  state.findIndex = -1;
  if (!range || !re) {
    hideFindHighlights();
    if (!range) $('#findStatus').textContent = 'Select text before using Selection only.';
    return false;
  }
  const text = editor.value.slice(range.start, range.end);
  let m;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    state.findMatches.push({ start: range.start + m.index, end: range.start + m.index + m[0].length });
  }
  if (!state.findMatches.length) {
    hideFindHighlights();
    $('#findStatus').textContent = 'No matches.';
    return false;
  }
  if (anchor !== null) {
    state.findIndex = state.findMatches.findIndex((m) => m.start >= anchor);
    if (state.findIndex < 0) state.findIndex = 0;
  } else state.findIndex = 0;
  $('#findStatus').textContent =
    `${state.findMatches.length.toLocaleString()} match${state.findMatches.length === 1 ? '' : 'es'}.`;
  renderFindHighlights();
  return true;
}
function revealFindMatch() {
  const m = state.findMatches[state.findIndex];
  if (!m) return;
  editor.focus();
  editor.setSelectionRange(m.start, m.end);
  scrollEditorToOffset(m.start);
  renderFindHighlights();
  updateSelInfo();
  $('#findStatus').textContent = `Match ${state.findIndex + 1} of ${state.findMatches.length}`;
}
function findMove(dir) {
  const anchor = editor.selectionEnd;
  if (
    !state.findMatches.length ||
    !state.findMatches.some((m) => m.start === editor.selectionStart && m.end === editor.selectionEnd)
  ) {
    if (!refreshFindMatches(dir > 0 ? anchor : editor.selectionStart)) return;
  } else {
    state.findIndex = (state.findIndex + dir + state.findMatches.length) % state.findMatches.length;
  }
  revealFindMatch();
}
function openFindModal() {
  const s = editor.selectionStart,
    e = editor.selectionEnd,
    selected = editor.value.slice(s, e);
  state.findScopeRange = s !== e ? { start: s, end: e } : null;
  $('#findScope').value = 'all';
  if (selected && selected.length <= 120 && !selected.includes('\n')) $('#findText').value = selected;
  $('#findModal').classList.add('open');
  setTimeout(() => {
    $('#findText').focus();
    $('#findText').select();
    refreshFindMatches(editor.selectionEnd);
  }, 0);
}
function closeFindModal() {
  $('#findModal').classList.remove('open');
  hideFindHighlights();
}
function replaceCurrentFind() {
  if (!state.findMatches.length && !refreshFindMatches(editor.selectionStart)) return;
  const m = state.findMatches[state.findIndex];
  if (!m) return;
  const opts = findOptions(),
    top = editor.scrollTop,
    val = editor.value,
    matchText = val.slice(m.start, m.end);
  const re = opts.regex ? buildFindRegex(false) : null;
  if (opts.regex && !re) return;
  const replacement = opts.regex ? matchText.replace(re, opts.replacement) : opts.replacement;
  pushUndoSnapshot();
  editor.value = val.slice(0, m.start) + replacement + val.slice(m.end);
  updateStats();
  restoreEditorScroll(top);
  state.findScopeRange = state.findScopeRange
    ? { start: state.findScopeRange.start, end: state.findScopeRange.end + (replacement.length - matchText.length) }
    : null;
  refreshFindMatches(m.start + replacement.length);
  revealFindMatch();
  toast('Replaced');
}
function replaceAllFind() {
  const range = findRange();
  const opts = findOptions();
  const re = buildFindRegex(true);
  if (!range || !re) return;
  refreshFindMatches();
  const count = state.findMatches.length;
  if (!count) {
    $('#findStatus').textContent = 'No matches.';
    return;
  }
  snapshotBefore('Before Replace All');
  const top = editor.scrollTop,
    val = editor.value,
    chunk = val.slice(range.start, range.end);
  const replaced = opts.regex ? chunk.replace(re, opts.replacement) : chunk.replace(re, () => opts.replacement);
  pushUndoSnapshot();
  editor.value = val.slice(0, range.start) + replaced + val.slice(range.end);
  updateStats();
  restoreEditorScroll(top);
  editor.focus();
  editor.setSelectionRange(range.start, range.start + replaced.length);
  state.findScopeRange = opts.scope === 'selection' ? { start: range.start, end: range.start + replaced.length } : null;
  state.findMatches = [];
  state.findIndex = -1;
  hideFindHighlights();
  $('#findStatus').textContent = `Replaced ${count.toLocaleString()} match${count === 1 ? '' : 'es'}.`;
  updateSelInfo();
  toast(`Replaced ${count.toLocaleString()}`);
}
window.addEventListener('resize', syncFindHighlights);
