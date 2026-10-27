// Markdown structure panel.
import { CHAPTER_CANDIDATE_RE, MD_STYLE_INFO, canonicalStructureMarker, markdownLineInfo } from '../core/structure.js';
import { escapeHtml } from '../core/text-utils.js';
import { $, editor } from './dom.js';
import { jumpToLine } from './editor-ops.js';

export function renderStructurePanel() {
  const summary = $('#structureSummary'),
    list = $('#structureList');
  if (!summary || !list) return;
  const lines = editor.value.split('\n');
  const rows = [];
  let chapters = 0,
    subheads = 0,
    special = 0,
    candidates = 0,
    blockMarker = '';
  lines.forEach((line, idx) => {
    const container = line.match(/^\s*:::\s*([a-z0-9_-]+)?\s*$/i);
    if (container) {
      blockMarker = canonicalStructureMarker(container[1] || '');
      return;
    }
    const md = markdownLineInfo(line);
    const clean = md ? md.content : line.trim();
    let marker = md?.marker || '';
    if (!marker && blockMarker && clean) marker = blockMarker;
    if (marker) {
      const info = MD_STYLE_INFO[marker] || [marker.toUpperCase(), 'supp'];
      const text = clean || '(empty marker)';
      rows.push({ line: idx + 1, marker, text, tag: info[0], group: info[1] });
      if (info[1] === 'chapter') chapters++;
      else if (info[1] === 'sub') subheads++;
      else special++;
      return;
    }
    if (clean && CHAPTER_CANDIDATE_RE.test(clean)) {
      candidates++;
      rows.push({ line: idx + 1, marker: 'candidate', text: clean, tag: 'CHECK', group: 'warn' });
    }
  });
  summary.innerHTML = `<div class="vsum"><b>${chapters}</b> chapters/parts</div><div class="vsum"><b>${subheads}</b> subheads</div><div class="vsum"><b>${special}</b> special</div><div class="vsum"><b>${candidates}</b> candidates</div>`;
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML =
      '<div class="empty-hint">No Markdown structure yet. Possible chapter lines will show here as CHECK.</div>';
    return;
  }
  rows.slice(0, 80).forEach((r) => {
    const div = document.createElement('div');
    div.className = 'structure-row';
    const tagClass = r.group === 'sub' ? 'sub' : r.group === 'supp' ? 'supp' : r.group === 'warn' ? 'warn' : '';
    div.innerHTML = `<span class="tag ${tagClass}">${escapeHtml(r.tag)}</span><span class="vtext">${escapeHtml(r.text)}</span><button class="jump">line ${r.line}</button>`;
    div.querySelector('button').addEventListener('click', () => jumpToLine(r.line));
    list.appendChild(div);
  });
  if (rows.length > 80) {
    const more = document.createElement('div');
    more.className = 'empty-hint';
    more.textContent = `Showing first 80 of ${rows.length} structure items/candidates.`;
    list.appendChild(more);
  }
}
