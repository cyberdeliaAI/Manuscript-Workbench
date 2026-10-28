// AI preview modal, integrity guardrails and stop handling.
import { state } from './state.js';
import { glossaryIssues } from '../core/glossary.js';
import { analyzeIntegrity } from '../core/integrity.js';
import { markerCount, markerSignature } from '../core/structure.js';
import { escapeHtml, progressPercent } from '../core/text-utils.js';
import { setLmBusy } from './ai.js';
import { renderRunPanel, requestRunStop } from './ai-run.js';
import { openCompare } from './compare.js';
import { $, toast } from './dom.js';
import { nothingAccepted, refreshReview, renderReview, resetReview, reviewedText } from './ai-review.js';
import { replaceRange } from './editor-ops.js';
import { snapshotBefore } from './project.js';
import { storage } from './storage.js';

export function reportPreviewMarkerDrift() {
  if (state.previewState.expectedMarkers === null) return;
  const beforeCount = markerCount(state.previewState.before),
    afterCount = markerCount(state.previewState.after);
  const afterSig = markerSignature(state.previewState.after);
  if (state.previewState.expectedMarkers !== afterSig) {
    $('#previewStatus').textContent =
      beforeCount === afterCount
        ? `Structure changed position/order, but count stayed ${afterCount}. Review before applying.`
        : `Structure count changed: before ${beforeCount}, after ${afterCount}. Review before applying.`;
    $('#lmStatus').textContent = $('#previewStatus').textContent;
  }
}
/** A run ended with output to look at: show the guardrails, flag moved structure, refresh the Diff view. */
export function showRunOutcome() {
  renderIntegrityGuardrails(state.previewState.before, state.previewState.after);
  reportPreviewMarkerDrift();
  refreshReview();
}
export function renderIntegrityGuardrails(before, after) {
  const panel = $('#integrityPanel');
  if (!panel) return;
  const result = analyzeIntegrity(before, after);
  for (const issue of glossaryIssues(before, after, state.previewState.glossary, state.previewState.task))
    result.issues.push(`glossary: ${issue.message}`);
  panel.className = 'integrity-panel show ' + (result.issues.length ? 'warn' : 'ok');
  const title = result.issues.length
    ? `Content guardrails: ${result.issues.length} item(s) to review`
    : 'Content guardrails: no major drift detected';
  const pills = [
    ...result.issues.map((x) => `<span class="pill issue">${escapeHtml(x)}</span>`),
    ...result.facts.map((x) => `<span class="pill">${escapeHtml(x)}</span>`),
  ];
  panel.innerHTML = `<div>${escapeHtml(title)}</div><div class="integrity-items">${pills.join('')}</div>`;
}
function clearIntegrityGuardrails() {
  const panel = $('#integrityPanel');
  if (panel) {
    panel.className = 'integrity-panel';
    panel.innerHTML = '';
  }
}
function previewSubText() {
  const base = `${state.previewState.before.length.toLocaleString()} chars → ${state.previewState.after.length.toLocaleString()} chars`;
  return state.previewState.progress ? `${base} · ${state.previewState.progress.percent}% done` : base;
}
export function setPreviewProgress(done, total) {
  state.previewState.progress = { done, total, percent: progressPercent(done, total) };
  $('#previewSub').textContent = previewSubText();
}
export function openPreview(title, before, after, start, end, running, applyMode = 'replace', extra = {}) {
  state.previewState = {
    title,
    before,
    after,
    start,
    end,
    finished: !running,
    running,
    expectedMarkers: null,
    applyMode,
    progress: null,
    review: null,
    run: null, // the sections of an AI run and their status (see ai-run.js)
    task: '',
    glossary: [],
    ...extra,
  };
  resetReview();
  renderRunPanel();
  clearIntegrityGuardrails();
  $('#previewTitle').textContent = title;
  $('#previewSub').textContent = previewSubText();
  $('#beforeBox').textContent = before;
  $('#afterBox').textContent = after;
  $('#previewModal').classList.add('open');
  setPreviewView(storage.get('previewView') || 'split');
  $('#applyPreviewBtn').disabled = running || !after || applyMode === 'none';
  $('#comparePreviewBtn').disabled = !before && !after;
  setStopButtons(running);
  setLmBusy(running);
  $('#showPreviewBtn').disabled = false;
  $('#streamState').textContent = running ? 'generating...' : 'ready';
  $('#previewStatus').textContent = running
    ? 'Generating...'
    : applyMode === 'none'
      ? 'Review ready.'
      : 'Preview ready.';
}
export function updatePreview() {
  $('#afterBox').textContent = state.previewState.after;
  $('#previewSub').textContent = previewSubText();
  $('#comparePreviewBtn').disabled = !state.previewState.before && !state.previewState.after;
  if ($('#autoScroll').checked) {
    const b = $('#afterBox');
    b.scrollTop = b.scrollHeight;
  }
}
function syncPreviewScroll(source, target) {
  if (state.previewScrollSyncing || !$('#previewLinked').checked || !target) return;
  state.previewScrollSyncing = true;
  const maxSource = Math.max(1, source.scrollHeight - source.clientHeight);
  const maxTarget = Math.max(0, target.scrollHeight - target.clientHeight);
  target.scrollTop = (source.scrollTop / maxSource) * maxTarget;
  requestAnimationFrame(() => {
    state.previewScrollSyncing = false;
  });
}
$('#showPreviewBtn').addEventListener('click', () => {
  $('#previewModal').classList.add('open');
  updatePreview();
});
$('#closePreviewBtn').addEventListener('click', () => $('#previewModal').classList.remove('open'));
$('#comparePreviewBtn').addEventListener('click', () =>
  openCompare(state.previewState.before || '', state.previewState.after || '', 'Loaded preview into Compare.'),
);
$('#applyPreviewBtn').addEventListener('click', () => {
  if (state.previewState.applyMode === 'none') {
    toast('This preview is review-only.');
    return;
  }
  if (!state.previewState.finished) return;
  reportPreviewMarkerDrift();
  if (nothingAccepted()) {
    toast('No change is accepted. Accept at least one change, or close the preview.');
    return;
  }
  snapshotBefore(`Before applying: ${String(state.previewState.title).replace(/^Preview:\s*/, '')}`);
  replaceRange(state.previewState.start, state.previewState.end, reviewedText());
  $('#previewModal').classList.remove('open');
  state.previewState.after = '';
  $('#showPreviewBtn').disabled = true;
  toast('Applied');
});
export function setStopButtons(enabled) {
  $('#stopBtn').disabled = !enabled;
  $('#lmStopBtn').disabled = !enabled;
}
function stopLmGeneration() {
  requestRunStop();
}
$('#stopBtn').addEventListener('click', stopLmGeneration);
$('#lmStopBtn').addEventListener('click', stopLmGeneration);
$('#bottomBtn').addEventListener('click', () => {
  $('#autoScroll').checked = true;
  const b = $('#afterBox');
  b.scrollTop = b.scrollHeight;
});
$('#afterBox').addEventListener('scroll', () => {
  const b = $('#afterBox');
  if (b.scrollTop + b.clientHeight < b.scrollHeight - 40) $('#autoScroll').checked = false;
});
$('#beforeBox').addEventListener('scroll', () => syncPreviewScroll($('#beforeBox'), $('#afterBox')));
$('#afterBox').addEventListener('scroll', () => syncPreviewScroll($('#afterBox'), $('#beforeBox')));
document.querySelectorAll('.viewBtn').forEach((b) => b.addEventListener('click', () => setPreviewView(b.dataset.view)));
function setPreviewView(view) {
  if (!['split', 'after-only', 'before-only', 'diff'].includes(view)) view = 'split';
  const modal = $('#previewModal'),
    card = $('#modalCard');
  [modal, card].forEach((el) => {
    el.classList.remove('after-only', 'before-only', 'diff-view');
    if (view === 'after-only') el.classList.add('after-only');
    if (view === 'before-only') el.classList.add('before-only');
    if (view === 'diff') el.classList.add('diff-view');
  });
  if (view === 'diff') renderReview();
  document.querySelectorAll('.viewBtn').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
  storage.set('previewView', view);
}
