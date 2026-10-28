// Runs the text analysis in a Web Worker (or on the main thread if workers are unavailable) and shows the result
// in the statistics, the diagnostics, the outline, the structure panel and the line gutter.
import { state } from './state.js';
import { analyzeText } from '../core/analysis.js';
import { renderDiagnose } from './diagnostics.js';
import { $, editor } from './dom.js';
import { setGutterData } from './gutter.js';
import { applyDetectedLanguage, typographyOptions } from './language.js';
import { renderOutline } from './outline.js';
import { renderStructurePanel } from './structure-panel.js';

const DEBOUNCE_MS = 120; // wait for a pause in typing...
const MAX_WAIT_MS = 1000; // ...but never longer than this while the author keeps typing

let worker = null;
let workerFailed = false;
let debounceTimer = null;
let maxWaitTimer = null;
let inFlight = false;
let dirty = false;
let requestId = 0;

function startWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('../workers/analysis.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      inFlight = false;
      const { id, result, error } = event.data;
      if (error) console.warn('Text analysis failed:', error);
      else if (id === requestId) applyResult(result);
      if (dirty) {
        dirty = false;
        analyzeNow();
      }
    };
    worker.onerror = (event) => {
      console.warn('The analysis worker failed; analysing on the main thread instead.', event.message);
      workerFailed = true;
      worker?.terminate();
      worker = null;
      inFlight = false;
      analyzeNow();
    };
  } catch (err) {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

function analysisOptions() {
  return { ...typographyOptions(), ignoredCandidates: state.ignoredCandidates };
}

/** Starts an analysis of the current text right away (a running one finishes first, then this one follows). */
export function analyzeNow() {
  clearTimeout(debounceTimer);
  clearTimeout(maxWaitTimer);
  debounceTimer = maxWaitTimer = null;
  if (inFlight) {
    dirty = true;
    return;
  }
  const text = editor.value;
  const options = analysisOptions();
  const id = ++requestId;
  const w = startWorker();
  if (w) {
    inFlight = true;
    w.postMessage({ id, text, options });
    return;
  }
  applyResult(analyzeText(text, options));
}

/** Analyses the text after a short pause in typing. Cheap to call on every keystroke. */
export function scheduleAnalysis(delay = DEBOUNCE_MS) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(analyzeNow, delay);
  if (!maxWaitTimer) maxWaitTimer = setTimeout(analyzeNow, MAX_WAIT_MS);
}

function applyResult(result) {
  state.analysis = result;
  const s = result.stats;
  $('#statChars').textContent = s.chars.toLocaleString();
  $('#statWords').textContent = s.words.toLocaleString();
  $('#statLines').textContent = s.lines.toLocaleString();
  $('#statChapters').textContent = s.chapters.toLocaleString();
  $('#statSubheads').textContent = s.subheads.toLocaleString();
  setGutterData(s.lines, result.gutter);
  renderDiagnose(result.diag);
  renderOutline(result.outline);
  renderStructurePanel(result.structure);
  applyDetectedLanguage(result.language);
}
