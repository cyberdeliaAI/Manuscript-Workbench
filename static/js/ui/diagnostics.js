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
    const count = (diag.positions[key]?.length || 0) / 2;
    const row = document.createElement('div');
    row.className = 'diag-row' + (count ? '' : ' zero');
    row.innerHTML = `<span class="dot ${dot}"></span><span class="lbl">${label}</span><span class="count">${count}</span><button class="jump">next</button>`;
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
  const positions = state.lastDiag?.positions?.[key];
  if (!positions || !positions.length) return;
  const total = positions.length / 2;
  jumpPointers[key] = ((jumpPointers[key] ?? -1) + 1) % total;
  const at = jumpPointers[key] * 2;
  const text = editor.value;
  const start = Math.max(0, Math.min(positions[at], text.length));
  const end = Math.max(start, Math.min(positions[at + 1], text.length));
  const lineNo = text.slice(0, start).split('\n').length;
  editor.focus();
  editor.setSelectionRange(start, end > start ? end : Math.min(text.length, start + 1));
  editor.scrollTop = Math.max(0, (lineNo - 1) * 20 - editor.clientHeight / 2);
  gutter.scrollTop = editor.scrollTop;
}
