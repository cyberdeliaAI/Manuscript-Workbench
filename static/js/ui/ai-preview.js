// AI preview modal, integrity guardrails and stop handling.
import { state } from './state.js';
import { analyzeIntegrity } from '../core/integrity.js';
import { markerCount, markerSignature } from '../core/structure.js';
import { escapeHtml, progressPercent } from '../core/text-utils.js';
import { setLmBusy } from './ai.js';
import { openCompare } from './compare.js';
import { $, toast } from './dom.js';
import { replaceRange } from './editor-ops.js';
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
export function renderIntegrityGuardrails(before, after) {
  const panel = $('#integrityPanel');
  if (!panel) return;
  const result = analyzeIntegrity(before, after);
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
export function openPreview(title, before, after, start, end, running, applyMode = 'replace') {
  state.previewState = {
    title,
    before,
    after,
    start,
    end,
    finished: !running,
    running,
    partial: false,
    expectedMarkers: null,
    applyMode,
    progress: null,
  };
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
export function finishPreviewError(msg) {
  state.previewState.running = false;
  setStopButtons(false);
  setLmBusy(false);
  $('#streamState').textContent = 'error';
  $('#previewStatus').textContent = msg;
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
  if (!state.previewState.finished || state.previewState.partial) return;
  reportPreviewMarkerDrift();
  replaceRange(state.previewState.start, state.previewState.end, state.previewState.after);
  $('#previewModal').classList.remove('open');
  state.previewState.after = '';
  $('#showPreviewBtn').disabled = true;
  toast('Applied');
});
export function setStopButtons(enabled) {
  $('#stopBtn').disabled = !enabled;
  $('#lmStopBtn').disabled = !enabled;
}
export function markLmStopped() {
  state.previewState.partial = true;
  state.previewState.running = false;
  setStopButtons(false);
  setLmBusy(false);
  $('#applyPreviewBtn').disabled = true;
  $('#streamState').textContent = 'stopped';
  $('#previewStatus').textContent = 'Stopped. Partial output is viewable but not applicable.';
  $('#lmStatus').textContent = 'Stopped; partial preview available.';
}
function stopLmGeneration() {
  markLmStopped();
  if (state.lmAbort) state.lmAbort.abort();
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
  if (!['split', 'after-only', 'before-only'].includes(view)) view = 'split';
  const modal = $('#previewModal'),
    card = $('#modalCard');
  [modal, card].forEach((el) => {
    el.classList.remove('after-only', 'before-only');
    if (view === 'after-only') el.classList.add('after-only');
    if (view === 'before-only') el.classList.add('before-only');
  });
  document.querySelectorAll('.viewBtn').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
  storage.set('previewView', view);
}
