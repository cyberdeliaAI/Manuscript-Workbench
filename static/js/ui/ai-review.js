// The Diff view of the AI preview: every changed paragraph can be accepted or rejected before it is applied.
import { state } from './state.js';
import { composeFromHunks, diffDocuments, reviewableIds } from '../core/diff.js';
import { glossaryIssues } from '../core/glossary.js';
import { $ } from './dom.js';

const PAGE_SIZE = 250; // rows rendered at once, so a book-sized review stays light
const expandedRuns = new Set();
let rendered = PAGE_SIZE;

function review() {
  return state.previewState.review || null;
}

export function resetReview() {
  state.previewState.review = null;
  expandedRuns.clear();
  rendered = PAGE_SIZE;
  syncApplyButton();
}

function ready() {
  const p = state.previewState;
  return p.applyMode !== 'none' && !p.running && !!p.after;
}

function ensureReview() {
  const p = state.previewState;
  if (!ready()) return null;
  if (!p.review || p.review.before !== p.before || p.review.after !== p.after) {
    const diff = diffDocuments(p.before, p.after);
    p.review = { diff, rejected: new Set(), before: p.before, after: p.after };
  }
  return p.review;
}

/** The text Apply should put into the editor: the AI output, minus the changes the reviewer rejected. */
export function reviewedText() {
  const r = review();
  const p = state.previewState;
  if (!r || r.after !== p.after || !r.rejected.size) return p.after;
  return composeFromHunks(r.diff, r.rejected);
}

export function nothingAccepted() {
  const r = review();
  return !!r && r.rejected.size > 0 && r.rejected.size === reviewableIds(r.diff).length;
}

function syncApplyButton() {
  const btn = $('#applyPreviewBtn');
  if (!btn) return;
  const p = state.previewState;
  const r = review();
  const total = r ? reviewableIds(r.diff).length : 0;
  const rejected = r && total ? r.rejected.size : 0;
  const kept = total - rejected;
  btn.textContent = rejected ? (kept ? `Apply ${kept} of ${total} changes` : 'Nothing accepted') : 'Apply change';
  btn.disabled = !(p.finished && !p.partial && p.after && p.applyMode !== 'none') || (rejected > 0 && !kept);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Glossary problems in one hunk (a protected term that is gone, a translation that was not used). */
function flagsOf(h) {
  if (!h.flags) {
    const p = state.previewState;
    h.flags = glossaryIssues(h.before ? h.before.text : '', h.after ? h.after.text : '', p.glossary, p.task);
  }
  return h.flags;
}

function flaggedIds(r) {
  return reviewableIds(r.diff).filter((id) => flagsOf(r.diff.hunks[id]).length);
}

function summaryText(r) {
  const { stats } = r.diff;
  const total = stats.changed + stats.added + stats.removed;
  if (!total) return 'No paragraph changed.';
  const kept = total - r.rejected.size;
  const parts = [];
  if (stats.changed) parts.push(`${stats.changed} rewritten`);
  if (stats.added) parts.push(`${stats.added} added`);
  if (stats.removed) parts.push(`${stats.removed} removed`);
  const flagged = flaggedIds(r).length;
  const flagNote = flagged ? ` ${flagged} break${flagged === 1 ? 's' : ''} the glossary.` : '';
  return `${kept} of ${total} changes accepted (${parts.join(', ')}; ${stats.same} paragraphs unchanged).${flagNote}`;
}

function wordsNode(words) {
  const box = el('div', 'hunk-text');
  for (const w of words) {
    if (w.op === 'eq') box.appendChild(document.createTextNode(w.text));
    else box.appendChild(el(w.op === 'del' ? 'del' : 'ins', 'w-' + w.op, w.text));
  }
  return box;
}

function hunkNode(h, r) {
  const rejected = r.rejected.has(h.id);
  const row = el('div', `hunk ${h.kind}${rejected ? ' rejected' : ''}`);
  row.dataset.id = String(h.id);
  const head = el('label', 'hunk-head');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !rejected;
  box.addEventListener('change', () => {
    if (box.checked) r.rejected.delete(h.id);
    else r.rejected.add(h.id);
    row.classList.toggle('rejected', !box.checked);
    row.querySelector('.hunk-body').replaceWith(bodyNode(h, !box.checked));
    $('#diffSummary').textContent = summaryText(r);
    syncApplyButton();
  });
  const label = { changed: 'Rewritten', added: 'Added paragraph', removed: 'Removed paragraph' }[h.kind];
  head.append(box, el('span', 'hunk-title', label));
  const flags = flagsOf(h);
  if (flags.length) {
    const note = el(
      'span',
      'hunk-flag',
      `⚑ ${flags[0].message}${flags.length > 1 ? ` (+${flags.length - 1} more)` : ''}`,
    );
    note.title = flags.map((f) => f.message).join('\n');
    head.appendChild(note);
  }
  row.append(head, bodyNode(h, rejected));
  return row;
}

function bodyNode(h, rejected) {
  const body = el('div', 'hunk-body');
  if (rejected) {
    body.appendChild(el('div', 'hunk-text kept', h.before ? h.before.text : '(not added)'));
  } else if (h.kind === 'changed') body.appendChild(wordsNode(h.words));
  else if (h.kind === 'added') body.appendChild(el('div', 'hunk-text', h.after.text)).classList.add('w-ins');
  else body.appendChild(el('div', 'hunk-text', h.before.text)).classList.add('w-del');
  return body;
}

function gapNode(run, key) {
  const open = expandedRuns.has(key);
  const row = el('div', 'hunk same');
  const toggle = el(
    'button',
    'hunk-gap',
    `${open ? '▾' : '▸'} ${run.length} unchanged paragraph${run.length === 1 ? '' : 's'}`,
  );
  toggle.addEventListener('click', () => {
    if (open) expandedRuns.delete(key);
    else expandedRuns.add(key);
    renderReview();
  });
  row.appendChild(toggle);
  if (open) for (const h of run) row.appendChild(el('div', 'hunk-text kept', h.after.text));
  return row;
}

export function renderReview() {
  const list = $('#diffList');
  if (!list) return;
  list.textContent = '';
  const r = ensureReview();
  const p = state.previewState;
  for (const id of ['diffAcceptAllBtn', 'diffRejectAllBtn', 'diffPrevBtn', 'diffNextBtn']) $('#' + id).disabled = !r;
  $('#diffRejectFlaggedBtn').disabled = !r || !flaggedIds(r).length;
  if (!r) {
    $('#diffSummary').textContent = '';
    list.appendChild(
      el(
        'div',
        'hunk-empty',
        p.applyMode === 'none'
          ? 'This is a review-only result: there is nothing to apply, so there is nothing to accept or reject.'
          : p.running
            ? 'The review is available when generation has finished.'
            : 'There is no output to review.',
      ),
    );
    return;
  }
  $('#diffSummary').textContent = summaryText(r);
  let shown = 0,
    runStart = -1;
  const hunks = r.diff.hunks;
  for (let i = 0; i <= hunks.length; i++) {
    const h = hunks[i];
    if (h && h.kind === 'same') {
      if (runStart < 0) runStart = i;
      continue;
    }
    if (runStart >= 0) {
      if (shown++ >= rendered) break;
      list.appendChild(gapNode(hunks.slice(runStart, i), runStart));
      runStart = -1;
    }
    if (!h) break;
    if (shown++ >= rendered) break;
    list.appendChild(hunkNode(h, r));
  }
  if (shown > rendered) {
    const more = el('button', 'hunk-more', 'Show more');
    more.addEventListener('click', () => {
      rendered += PAGE_SIZE;
      renderReview();
    });
    list.appendChild(more);
  }
  syncApplyButton();
}

function setAll(rejectAll) {
  const r = ensureReview();
  if (!r) return;
  r.rejected = new Set(rejectAll ? reviewableIds(r.diff) : []);
  renderReview();
}

function jump(step) {
  const list = $('#diffList');
  const rows = [...list.querySelectorAll('.hunk:not(.same)')];
  if (!rows.length) return;
  const top = list.getBoundingClientRect().top;
  const here = rows.findIndex((row) => row.getBoundingClientRect().top > top + 8);
  let target;
  if (step > 0) target = here < 0 ? rows[rows.length - 1] : rows[here];
  else target = rows[Math.max(0, (here < 0 ? rows.length : here) - 2)];
  target.scrollIntoView({ block: 'start' });
}

/** Called when a run ends while the Diff view is open, or when the view is opened. */
export function refreshReview() {
  syncApplyButton();
  if ($('#previewModal').classList.contains('diff-view')) renderReview();
}

$('#diffAcceptAllBtn').addEventListener('click', () => setAll(false));
$('#diffRejectAllBtn').addEventListener('click', () => setAll(true));
$('#diffRejectFlaggedBtn').addEventListener('click', () => {
  const r = ensureReview();
  if (!r) return;
  for (const id of flaggedIds(r)) r.rejected.add(id);
  renderReview();
});
$('#diffNextBtn').addEventListener('click', () => jump(1));
$('#diffPrevBtn').addEventListener('click', () => jump(-1));
