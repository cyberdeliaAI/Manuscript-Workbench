// Editor helpers: ranges, scrolling and replacing text.
import { lineOffsetsFor } from '../core/structure.js';
import { clamp, removeOneIndent } from '../core/text-utils.js';
import { editor, gutter } from './dom.js';
import { syncFindHighlights } from './find.js';
import { updateSelInfo, updateStats } from './stats.js';
import { pushUndoSnapshot } from './undo.js';

export function getScope() {
  return document.querySelector('input[name=scope]:checked')?.value || 'all';
}
export function selectedTextLength() {
  return Math.max(0, editor.selectionEnd - editor.selectionStart);
}
function measureEditorOffsetTop(pos) {
  const style = getComputedStyle(editor);
  const mirror = document.createElement('div');
  const before = editor.value.slice(0, Math.max(0, Math.min(pos, editor.value.length)));
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.left = '-10000px';
  mirror.style.top = '0';
  mirror.style.width = editor.clientWidth + 'px';
  mirror.style.boxSizing = 'border-box';
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.padding = style.padding;
  mirror.style.border = '0';
  mirror.style.tabSize = style.tabSize || '4';
  mirror.style.whiteSpace = editor.classList.contains('wrap') ? 'pre-wrap' : 'pre';
  mirror.style.overflowWrap = editor.classList.contains('wrap') ? 'break-word' : 'normal';
  mirror.textContent = before;
  const mark = document.createElement('span');
  mark.textContent = '\u200b';
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const top = mark.offsetTop;
  mirror.remove();
  return top;
}
export function scrollEditorToOffset(pos) {
  const top = measureEditorOffsetTop(pos);
  const max = Math.max(0, editor.scrollHeight - editor.clientHeight);
  editor.scrollTop = clamp(top - editor.clientHeight * 0.45, 0, max);
  gutter.scrollTop = editor.scrollTop;
  syncFindHighlights();
}
export function jumpToOffset(pos) {
  editor.focus();
  editor.setSelectionRange(pos, pos);
  scrollEditorToOffset(pos);
  updateSelInfo();
}
export function currentParagraphRange() {
  const val = editor.value;
  const { lines, offs } = lineOffsetsFor(val);
  const pos = editor.selectionStart;
  let li = 0;
  for (let i = 0; i < offs.length; i++) {
    if (offs[i] <= pos) li = i;
    else break;
  }
  let startLine = li,
    endLine = li;
  if (lines[li] && lines[li].trim() !== '') {
    while (startLine > 0 && lines[startLine - 1].trim() !== '') startLine--;
    while (endLine < lines.length - 1 && lines[endLine + 1].trim() !== '') endLine++;
  }
  const start = offs[startLine] || 0;
  const end = (offs[endLine] || 0) + (lines[endLine] || '').length;
  return { start, end };
}
export function selectedLineRange() {
  const s = editor.selectionStart,
    e = editor.selectionEnd;
  const val = editor.value;
  const start = val.lastIndexOf('\n', s - 1) + 1;
  let end = val.indexOf('\n', e);
  if (end < 0) end = val.length;
  return { start, end };
}
export function restoreEditorScroll(top) {
  editor.scrollTop = top;
  gutter.scrollTop = top;
  requestAnimationFrame(() => {
    editor.scrollTop = top;
    gutter.scrollTop = top;
  });
}
export function replaceRange(start, end, text) {
  const top = editor.scrollTop;
  pushUndoSnapshot();
  editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
  editor.focus();
  editor.setSelectionRange(start, start + text.length);
  updateStats();
  restoreEditorScroll(top);
  updateSelInfo();
}
function lineRangeForSelection() {
  const val = editor.value,
    s = editor.selectionStart,
    e = editor.selectionEnd;
  const effectiveEnd = e > s && val[e - 1] === '\n' ? e - 1 : e;
  const start = val.lastIndexOf('\n', s - 1) + 1;
  let end = val.indexOf('\n', effectiveEnd);
  if (end < 0) end = val.length;
  return { start, end };
}
export function handleTabIndent(event) {
  if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return;
  event.preventDefault();
  const val = editor.value,
    s = editor.selectionStart,
    e = editor.selectionEnd,
    top = editor.scrollTop,
    unit = '    ';
  pushUndoSnapshot();
  if (s === e && !event.shiftKey) {
    editor.value = val.slice(0, s) + unit + val.slice(e);
    editor.focus();
    editor.setSelectionRange(s + unit.length, s + unit.length);
    updateStats();
    restoreEditorScroll(top);
    updateSelInfo();
    return;
  }
  const range = lineRangeForSelection();
  const block = val.slice(range.start, range.end);
  const lines = block.split('\n');
  let deltaBeforeStart = 0,
    totalDelta = 0,
    lineOffset = range.start;
  const changed = lines
    .map((line) => {
      const before = line;
      let after, delta;
      if (event.shiftKey) {
        const res = removeOneIndent(line);
        after = res.line;
        delta = -res.removed;
      } else {
        after = unit + line;
        delta = unit.length;
      }
      if (lineOffset < s) deltaBeforeStart += delta;
      totalDelta += delta;
      lineOffset += before.length + 1;
      return after;
    })
    .join('\n');
  editor.value = val.slice(0, range.start) + changed + val.slice(range.end);
  const newStart = Math.max(range.start, s + deltaBeforeStart);
  const newEnd = Math.max(newStart, e + totalDelta);
  editor.focus();
  editor.setSelectionRange(newStart, newEnd);
  updateStats();
  restoreEditorScroll(top);
  updateSelInfo();
}
export function jumpToLine(n) {
  const lines = editor.value.split('\n');
  let pos = 0;
  for (let i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  editor.focus();
  editor.setSelectionRange(pos, Math.min(editor.value.length, pos + (lines[n - 1] || '').length));
  editor.scrollTop = Math.max(0, (n - 1) * 20 - editor.clientHeight / 2);
  gutter.scrollTop = editor.scrollTop;
}
