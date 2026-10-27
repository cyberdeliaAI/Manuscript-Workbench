// Diagnostics panel.
import { state } from './state.js';
import { DIAG_DEFS } from '../core/diagnostics.js';
import { $, editor, gutter } from './dom.js';

const jumpPointers = {};
export function renderDiagnose(diag) {
  const list = $('#diagList');
  if (!list) return;
  list.innerHTML = '';
  DIAG_DEFS.forEach(([key, label, dot]) => {
    const arr = diag.matches[key] || [];
    const row = document.createElement('div');
    row.className = 'diag-row' + (arr.length ? '' : ' zero');
    row.innerHTML = `<span class="dot ${dot}"></span><span class="lbl">${label}</span><span class="count">${arr.length}</span><button class="jump">next</button>`;
    row.querySelector('.jump').addEventListener('click', () => jumpToDiag(key));
    list.appendChild(row);
  });
  const mixed = diag.straightQuotes > 0 && diag.curlyQuotes > 0;
  const q = document.createElement('div');
  q.className = 'diag-row' + (mixed ? '' : ' zero');
  q.innerHTML = `<span class="dot ${mixed ? 'blue' : 'grey'}"></span><span class="lbl">Quotes: ${diag.straightQuotes} straight, ${diag.curlyQuotes} curly${mixed ? ' - mixed' : ''}</span>`;
  list.appendChild(q);
  state.lastDiag = diag;
}
function jumpToDiag(key) {
  const arr = state.lastDiag?.matches?.[key] || [];
  if (!arr.length) return;
  jumpPointers[key] = ((jumpPointers[key] ?? -1) + 1) % arr.length;
  const m = arr[jumpPointers[key]];
  const start = Math.max(0, Math.min(m.start, editor.value.length));
  const end = Math.max(start, Math.min(m.end, editor.value.length));
  const lineNo = editor.value.slice(0, start).split('\n').length;
  editor.focus();
  editor.setSelectionRange(start, end > start ? end : Math.min(editor.value.length, start + 1));
  editor.scrollTop = Math.max(0, (lineNo - 1) * 20 - editor.clientHeight / 2);
  gutter.scrollTop = editor.scrollTop;
}
