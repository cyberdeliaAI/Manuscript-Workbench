// The run engine behind every AI action. A run is one or more sections (the whole text, chunks, or headings) that are
// generated one after the other. Each section has a status of its own, so a run that is stopped or hits an error can
// be resumed, a section can be retried, and the sections that did finish can be applied. The status panel in the
// preview shows the sections.
import { state } from './state.js';
import { sanitizeLmFinalText } from '../core/ai-stream.js';
import {
  beginItem,
  composeRun,
  createRun,
  describeRun,
  failItem,
  finishItem,
  finishReasonsOf,
  isComplete,
  pendingIndexes,
  resetItem,
  runCounts,
  stopItem,
} from '../core/run.js';
import { markerSignature } from '../core/structure.js';
import { progressPercent } from '../core/text-utils.js';
import { setLmBusy } from './ai.js';
import { openPreview, setPreviewProgress, setStopButtons, showRunOutcome, updatePreview } from './ai-preview.js';
import { streamOne } from './ai-request.js';
import { refreshReview } from './ai-review.js';
import { $, toast } from './dom.js';
import { glossaryEntries } from './glossary.js';

/**
 * Opens the preview and generates `sources` one by one.
 *   title, range  what the preview is called, and the editor range the result replaces
 *   sources       the text of every section (one entry for a run without sections)
 *   task          'rewrite' | 'clean' | 'translate' | 'guided-rewrite' | 'questions' | 'feedback'
 *   noun, label   what a section is called ('chunk', 'section') and how the finished run is announced
 *   buildRequest  (source) => { prompt, input } for one section
 */
export async function startRun({
  title,
  range,
  sources,
  task,
  applyMode = 'replace',
  noun = 'section',
  label = 'Generation',
  note = '',
  buildRequest,
}) {
  const reviewOnly = applyMode === 'none';
  openPreview(title, range.text, '', range.start, range.end, true, applyMode, {
    task,
    glossary: reviewOnly ? [] : glossaryEntries(),
  });
  const ps = state.previewState;
  ps.expectedMarkers = reviewOnly ? null : markerSignature(range.text);
  ps.sectionSplitNote = note;
  ps.run = { ...createRun(sources), noun, label, buildRequest, selected: -1 };
  await runIndexes(ps, pendingIndexes(ps.run));
}

async function runIndexes(ps, indexes) {
  const run = ps.run;
  ps.running = true;
  ps.finished = false;
  ps.stopRequested = false;
  $('#applyPreviewBtn').disabled = true;
  $('#showPreviewBtn').disabled = false;
  setStopButtons(true);
  setLmBusy(true);
  renderRunPanel();
  let failed = null;
  try {
    for (const index of indexes) {
      if (ps.stopRequested || state.previewState !== ps) break;
      const outcome = await runItem(ps, run.items[index]);
      if (outcome === 'failed') failed = run.items[index];
      if (outcome !== 'done') break;
    }
  } finally {
    finishRun(ps, failed);
  }
}

function showProgress(ps, item) {
  const run = ps.run;
  const counts = runCounts(run);
  if (counts.total === 1) {
    $('#streamState').textContent = 'generating...';
    $('#previewStatus').textContent = 'Generating...';
    return;
  }
  const pct = progressPercent(counts.done, counts.total);
  setPreviewProgress(counts.done, counts.total);
  $('#streamState').textContent = `${pct}% · ${run.noun} ${item.index + 1}/${counts.total}`;
  $('#previewStatus').textContent = `Generating ${run.noun} ${item.index + 1} of ${counts.total} (${pct}% done)...`;
}

function pause(ps, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    ps.wake = () => {
      clearTimeout(timer);
      resolve();
    };
  }).then(() => {
    ps.wake = null;
  });
}

async function runItem(ps, item) {
  const run = ps.run;
  const retries = Math.max(0, parseInt($('#autoRetry')?.value, 10) || 0);
  const before = composeRun({ items: run.items.slice(0, item.index) }, { sanitize: sanitizeLmFinalText });
  const prefix = item.index ? `${before}\n\n` : '';
  for (let tries = 0; ; tries++) {
    beginItem(item);
    showProgress(ps, item);
    renderRunPanel();
    try {
      const request = run.buildRequest(item.source);
      const info = await streamOne(request.prompt, request.input, (text) => {
        item.output += text;
        ps.after = prefix + item.output;
        updatePreview();
      });
      finishItem(item, info.finishReasons);
      return 'done';
    } catch (err) {
      if (ps.stopRequested || err?.name === 'AbortError') {
        stopItem(item);
        return 'stopped';
      }
      if (!err?.fatal && tries < retries) {
        const seconds = 2 * (tries + 1);
        const reason = String(err?.message || 'error').slice(0, 140);
        $('#previewStatus').textContent =
          `${run.noun[0].toUpperCase()}${run.noun.slice(1)} ${item.index + 1} failed (${reason}). Trying again in ${seconds} s (${tries + 1} of ${retries})...`;
        await pause(ps, seconds * 1000);
        if (ps.stopRequested) {
          stopItem(item);
          return 'stopped';
        }
        continue;
      }
      failItem(item, err?.message);
      return 'failed';
    }
  }
}

/** The Stop button: abort the request in flight and keep what was finished. */
export function requestRunStop() {
  const ps = state.previewState;
  if (!ps.run || !ps.running) return;
  ps.stopRequested = true;
  if (ps.wake) ps.wake();
  if (state.lmAbort) state.lmAbort.abort();
  $('#previewStatus').textContent = 'Stopping...';
}

function finishWarningText(ps) {
  const reasons = ps.finishReasons || [];
  if (reasons.includes('length'))
    return 'Warning: the provider stopped because the output hit a length limit; the last section may be incomplete.';
  if (reasons.includes('content_filter')) return 'Warning: the provider stopped because of a content filter.';
  return '';
}

function finishRun(ps, failed) {
  if (state.previewState !== ps) return;
  const run = ps.run;
  ps.running = false;
  ps.finished = true;
  setStopButtons(false);
  setLmBusy(false);
  ps.after = composeRun(run, { sanitize: sanitizeLmFinalText });
  ps.finishReasons = finishReasonsOf(run);
  updatePreview();
  const counts = runCounts(run);
  const multi = counts.total > 1;
  const pct = progressPercent(counts.done, counts.total);
  if (multi) setPreviewProgress(counts.done, counts.total);
  const reviewOnly = ps.applyMode === 'none';
  const complete = isComplete(run);
  const hasOutput = counts.done > 0 && ps.after.trim() !== '';
  $('#applyPreviewBtn').disabled = reviewOnly || !hasOutput;
  const notes = [ps.sectionSplitNote, finishWarningText(ps)].filter(Boolean).join(' ');
  let status;
  if (complete && reviewOnly) status = 'Guidance complete. Review only; not applicable.';
  else if (complete && !hasOutput) status = `${run.label} produced no applicable text.${notes ? ' ' + notes : ''}`;
  else if (complete) status = `${run.label} complete.${notes ? ' ' + notes : ''}`;
  else {
    const left = hasOutput && !reviewOnly ? ` Apply uses the finished ${run.noun}s; the rest stays as it was.` : '';
    const where = multi ? `${describeRun(run, run.noun)}.` : '';
    if (failed) {
      const who = multi ? `${run.noun[0].toUpperCase()}${run.noun.slice(1)} ${failed.index + 1}` : 'The request';
      status = `${who} failed: ${failed.error.replace(/[\s.]+$/, '')}. ${where}${left}`;
      toast(failed.error);
    } else status = `Stopped. ${where}${left}`;
    status = status.trim();
  }
  let streamState = 'done';
  if (!complete) streamState = failed ? 'error' : 'stopped';
  if (multi) streamState = complete ? 'done · 100%' : `${failed ? 'paused' : 'stopped'} · ${pct}%`;
  $('#streamState').textContent = streamState;
  $('#previewStatus').textContent = status;
  $('#lmStatus').textContent = status;
  if (failed) run.selected = failed.index;
  renderRunPanel();
  if (hasOutput && !reviewOnly) showRunOutcome();
  else refreshReview();
}

// ---- the status panel -----------------------------------------------------------------------------

function sectionName(run, item) {
  return `${run.noun[0].toUpperCase()}${run.noun.slice(1)} ${item.index + 1} of ${run.items.length}`;
}

function runFrom(ps, indexes) {
  if (ps.running || !indexes.length) return;
  for (const index of indexes) if (ps.run.items[index].status === 'done') resetItem(ps.run.items[index]);
  runIndexes(ps, indexes);
}

function detailNode(ps) {
  const run = ps.run;
  const item = run.items[run.selected];
  const box = document.createElement('div');
  box.className = 'run-detail-line';
  if (!item) return box;
  const parts = [run.items.length > 1 ? sectionName(run, item) : 'This request', item.status];
  if (item.error) parts.push(item.error);
  if (item.attempts > 1) parts.push(`${item.attempts} attempts`);
  if (item.status === 'done' && item.finishReasons.includes('length')) parts.push('hit a length limit');
  const text = document.createElement('span');
  text.textContent = parts.join(' · ');
  box.appendChild(text);
  const add = (label, handler) => {
    const btn = document.createElement('button');
    btn.className = 'mini';
    btn.textContent = label;
    btn.disabled = ps.running;
    btn.addEventListener('click', handler);
    box.appendChild(btn);
  };
  if (item.status === 'done') add('Redo', () => runFrom(ps, [item.index]));
  else {
    add(run.items.length > 1 ? 'Run this' : 'Run again', () => runFrom(ps, [item.index]));
    if (run.items.length > 1 && pendingIndexes(run, item.index).length > 1)
      add('Run from here', () => runFrom(ps, pendingIndexes(run, item.index)));
  }
  return box;
}

export function renderRunPanel() {
  const panel = $('#runPanel');
  if (!panel) return;
  const ps = state.previewState;
  const run = ps.run;
  const show = !!run && (run.items.length > 1 || !isComplete(run));
  panel.classList.toggle('show', show);
  if (!show) return;
  const counts = runCounts(run);
  const multi = run.items.length > 1;
  $('#runSummary').textContent = multi ? describeRun(run, run.noun) : `Request ${run.items[0].status}`;
  if (!multi) run.selected = 0;
  else if (run.selected < 0 && counts.failed + counts.stopped === 1)
    run.selected = run.items.find((item) => item.status === 'failed' || item.status === 'stopped').index;
  const resume = $('#runResumeBtn');
  const pending = pendingIndexes(run);
  resume.hidden = !multi;
  resume.disabled = ps.running || !pending.length;
  const chips = $('#runChips');
  chips.textContent = '';
  chips.hidden = !multi;
  if (multi) {
    for (const item of run.items) {
      const chip = document.createElement('button');
      chip.className = `run-chip ${item.status}${item.index === run.selected ? ' selected' : ''}`;
      chip.textContent = String(item.index + 1);
      chip.title = `${sectionName(run, item)}: ${item.status}${item.error ? ` (${item.error})` : ''}`;
      chip.addEventListener('click', () => {
        run.selected = item.index;
        renderRunPanel();
      });
      chips.appendChild(chip);
    }
  }
  const detail = $('#runDetail');
  detail.textContent = '';
  if (run.selected >= 0) detail.appendChild(detailNode(ps));
}

$('#runResumeBtn').addEventListener('click', () => {
  const ps = state.previewState;
  if (ps.run) runFrom(ps, pendingIndexes(ps.run));
});
