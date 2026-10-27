// Chapter navigator.
import { headingOutline, outlineKey } from '../core/structure.js';
import { escapeHtml } from '../core/text-utils.js';
import { startLM } from './ai.js';
import { $, editor, gutter } from './dom.js';
import { jumpToOffset } from './editor-ops.js';
import { updateSelInfo } from './stats.js';

const collapsedOutlineHeadings = new Set();
function selectChapterRange(row) {
  editor.focus();
  editor.setSelectionRange(row.start, row.end);
  editor.scrollTop = Math.max(0, (row.line - 1) * 20 - editor.clientHeight / 2);
  gutter.scrollTop = editor.scrollTop;
  updateSelInfo();
}
export function renderOutline() {
  const list = $('#outlineList');
  if (!list) return;
  const rows = headingOutline(editor.value);
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<div class="empty-hint">No # headings yet. Mark chapters with # to build an outline.</div>';
    return;
  }
  let hiddenLevel = null;
  rows.forEach((row, index) => {
    if (hiddenLevel !== null) {
      if (row.level > hiddenLevel) return;
      hiddenLevel = null;
    }
    const key = outlineKey(row);
    const hasChildren = index < rows.length - 1 && rows[index + 1].level > row.level;
    const collapsed = collapsedOutlineHeadings.has(key);
    const div = document.createElement('div');
    div.className = `outline-row l${row.level}` + (row.level > 1 ? ' sub' : '');
    div.style.paddingLeft = `${16 + Math.min(Math.max(row.level - 1, 0), 4) * 14}px`;
    const tag = row.level === 1 ? 'CH' : `H${row.level}`;
    const title = row.title || '(untitled)';
    const toggle = hasChildren
      ? `<button data-act="toggle" class="outline-toggle" title="${collapsed ? 'Expand' : 'Collapse'}">${collapsed ? '+' : '-'}</button>`
      : '';
    div.innerHTML = `<span class="outline-tag">${tag}</span><div class="outline-main"><div class="outline-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div><div class="outline-meta">line ${row.line} · ${row.words.toLocaleString()} words</div></div><div class="outline-actions">${toggle}<button data-act="jump">Go</button>${row.level === 1 ? '<button data-act="rewrite">AI</button><button data-act="clean">Clean</button>' : ''}</div>`;
    const toggleBtn = div.querySelector('[data-act="toggle"]');
    if (toggleBtn)
      toggleBtn.addEventListener('click', () => {
        if (collapsedOutlineHeadings.has(key)) collapsedOutlineHeadings.delete(key);
        else collapsedOutlineHeadings.add(key);
        renderOutline();
      });
    div.querySelector('[data-act="jump"]').addEventListener('click', () => jumpToOffset(row.start));
    const rewrite = div.querySelector('[data-act="rewrite"]');
    if (rewrite)
      rewrite.addEventListener('click', () => {
        selectChapterRange(row);
        startLM('rewrite', 'selection', false);
      });
    const clean = div.querySelector('[data-act="clean"]');
    if (clean)
      clean.addEventListener('click', () => {
        selectChapterRange(row);
        startLM('clean', 'selection', false);
      });
    list.appendChild(div);
    if (collapsed) hiddenLevel = row.level;
  });
}
