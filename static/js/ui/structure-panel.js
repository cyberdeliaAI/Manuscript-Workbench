// Markdown structure panel, including the chapter candidate manager (Mark / Ignore / Mark all).
import { state } from './state.js';
import { analyzeStructure, markCandidateLines } from '../core/candidates.js';
import { escapeHtml } from '../core/text-utils.js';
import { $, editor, toast } from './dom.js';
import { jumpToLine, replaceRange } from './editor-ops.js';
import { scheduleAnalysis } from './analysis.js';
import { markProjectDirty, snapshotBefore } from './project.js';
import { saveSettings } from './settings.js';

const MAX_STRUCTURE_ROWS = 80;
const MAX_CANDIDATE_ROWS = 200;

export function renderStructurePanel(result = state.analysis?.structure) {
  const summary = $('#structureSummary'),
    list = $('#structureList');
  if (!summary || !list) return;
  if (!result) result = { chapters: 0, subheads: 0, special: 0, rows: [], candidates: [], ignored: [] };
  const { chapters, subheads, special, rows, candidates, ignored } = result;
  summary.innerHTML = `<div class="vsum"><b>${chapters}</b> chapters/parts</div><div class="vsum"><b>${subheads}</b> subheads</div><div class="vsum"><b>${special}</b> special</div><div class="vsum"><b>${candidates.length}</b> candidates</div>`;
  renderCandidates(candidates, ignored);
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<div class="empty-hint">No Markdown structure yet. Possible chapter lines show up above.</div>';
    return;
  }
  rows.slice(0, MAX_STRUCTURE_ROWS).forEach((r) => {
    const div = document.createElement('div');
    div.className = 'structure-row';
    const tagClass = r.group === 'sub' ? 'sub' : r.group === 'supp' ? 'supp' : '';
    div.innerHTML = `<span class="tag ${tagClass}">${escapeHtml(r.tag)}</span><span class="vtext">${escapeHtml(r.text)}</span><button class="jump">line ${r.line}</button>`;
    div.querySelector('button').addEventListener('click', () => jumpToLine(r.line));
    list.appendChild(div);
  });
  if (rows.length > MAX_STRUCTURE_ROWS) {
    const more = document.createElement('div');
    more.className = 'empty-hint';
    more.textContent = `Showing first ${MAX_STRUCTURE_ROWS} of ${rows.length} structure items.`;
    list.appendChild(more);
  }
}

function renderCandidates(candidates, ignored) {
  const box = $('#candidateList');
  if (!box) return;
  box.innerHTML = '';
  if (!candidates.length && !ignored.length) return;
  const head = document.createElement('div');
  head.className = 'candidate-head';
  head.innerHTML = `<span class="candidate-title">Possible chapters <b>${candidates.length}</b></span><span class="candidate-actions"></span>`;
  const actions = head.querySelector('.candidate-actions');
  if (candidates.length) actions.appendChild(button('Mark all as chapters', () => markAllCandidates()));
  if (ignored.length) actions.appendChild(button(`Ignored (${ignored.length}) - restore`, restoreIgnored));
  box.appendChild(head);
  candidates.slice(0, MAX_CANDIDATE_ROWS).forEach((c) => {
    const div = document.createElement('div');
    div.className = 'structure-row candidate-row';
    div.innerHTML = `<span class="tag warn">CHECK</span><span class="vtext" title="${escapeHtml(c.text)}">${escapeHtml(c.text)}</span><span class="candidate-actions"></span>`;
    const row = div.querySelector('.candidate-actions');
    row.appendChild(button(`line ${c.line}`, () => jumpToLine(c.line), 'jump'));
    row.appendChild(button('Chapter', () => markCandidate(c, 'h1'), 'jump', 'Mark as a chapter or part (#)'));
    row.appendChild(button('H2', () => markCandidate(c, 'h2'), 'jump', 'Mark as a subhead (##)'));
    row.appendChild(button('Ignore', () => ignoreCandidate(c), 'jump', 'This is body text; stop suggesting it'));
    box.appendChild(div);
  });
  if (candidates.length > MAX_CANDIDATE_ROWS) {
    const more = document.createElement('div');
    more.className = 'empty-hint';
    more.textContent = `Showing first ${MAX_CANDIDATE_ROWS} of ${candidates.length} candidates.`;
    box.appendChild(more);
  }
}

function button(label, onClick, className = 'mini', title = '') {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  if (title) el.title = title;
  el.addEventListener('click', onClick);
  return el;
}

function markCandidate(candidate, level) {
  const lines = editor.value.split('\n');
  const idx = candidate.line - 1;
  if (!lines[idx] || lines[idx].trim() !== candidate.text) {
    toast('That line has changed since the list was made.');
    renderStructurePanel();
    return;
  }
  const start = lines.slice(0, idx).reduce((n, l) => n + l.length + 1, 0);
  replaceRange(start, start + lines[idx].length, (level === 'h2' ? '## ' : '# ') + lines[idx].trim());
  toast(`Marked "${candidate.text}"`);
}

function markAllCandidates() {
  // look at the text as it is now: the list on screen may be a moment old
  const text = editor.value;
  const candidates = analyzeStructure(text, state.ignoredCandidates).candidates;
  if (!candidates.length) return;
  if (!confirm(`Mark ${candidates.length} line(s) as chapters?`)) return;
  const next = markCandidateLines(
    text,
    candidates.map((c) => c.line),
    'h1',
  );
  if (next === text) return;
  snapshotBefore('Before marking all chapters');
  replaceRange(0, text.length, next); // a single undo step
  editor.setSelectionRange(0, 0);
  toast(`Marked ${candidates.length} chapter(s)`);
}

function ignoreCandidate(candidate) {
  if (!state.ignoredCandidates.includes(candidate.key)) state.ignoredCandidates.push(candidate.key);
  saveSettings();
  markProjectDirty();
  scheduleAnalysis(0);
}

function restoreIgnored() {
  state.ignoredCandidates = [];
  saveSettings();
  markProjectDirty();
  scheduleAnalysis(0);
}
