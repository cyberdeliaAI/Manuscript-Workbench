// Undo stack for tool operations.
import { $, editor, toast } from './dom.js';
import { restoreEditorScroll } from './editor-ops.js';
import { updateStats } from './stats.js';

export const undoStack = [];
export function updateUndoButton() {
  $('#undoBtn').disabled = !undoStack.length;
}
export function pushUndoSnapshot() {
  undoStack.push({
    text: editor.value,
    start: editor.selectionStart,
    end: editor.selectionEnd,
    scrollTop: editor.scrollTop,
  });
  if (undoStack.length > 20) undoStack.shift();
  updateUndoButton();
}
function undoLastOperation() {
  const snap = undoStack.pop();
  if (!snap) return;
  editor.value = snap.text;
  editor.focus();
  editor.setSelectionRange(snap.start, snap.end);
  updateStats();
  restoreEditorScroll(snap.scrollTop || 0);
  updateUndoButton();
  toast('Undone');
}
$('#undoBtn').addEventListener('click', undoLastOperation);
