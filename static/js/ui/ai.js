// AI tab: provider setup and rewrite/clean/guided/translate runs.
import { state } from './state.js';
import { AI_PROVIDERS, createNdjsonParser, isLocalEndpointHost, sanitizeLmFinalText } from '../core/ai-stream.js';
import { headingSplitNote, makeChunks, makeHeadingSections } from '../core/chunking.js';
import {
  DEFAULT_PROMPTS,
  buildLmUserContent,
  guidedSystemPrompt,
  guidedUserContent,
  prepareTextForLm,
} from '../core/prompts.js';
import { markerSignature } from '../core/structure.js';
import { escapeHtml, progressPercent } from '../core/text-utils.js';
import {
  finishPreviewError,
  markLmStopped,
  openPreview,
  renderIntegrityGuardrails,
  reportPreviewMarkerDrift,
  setPreviewProgress,
  setStopButtons,
  updatePreview,
} from './ai-preview.js';
import { api, apiHeaders } from './api.js';
import { $, editor, toast } from './dom.js';
import { currentParagraphRange, selectedTextLength } from './editor-ops.js';
import { saveSettings } from './settings.js';

export function currentAiProvider() {
  return AI_PROVIDERS[$('#lmProvider')?.value] || AI_PROVIDERS.custom;
}
function resetModelSelect(placeholder = 'Detect first available model') {
  const sel = $('#lmModel');
  if (!sel) return;
  sel.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
}
export function updateProviderUi() {
  const provider = currentAiProvider();
  $('#lmNote').textContent = provider.note;
  $('#lmStatus').textContent = `${provider.label} idle.`;
}
$('#detectModelBtn').addEventListener('click', detectModels);
async function detectModels() {
  const provider = currentAiProvider();
  try {
    $('#lmStatus').textContent = `Detecting ${provider.label} models...`;
    const res = await api('/api/lm_models', {
      base_url: $('#lmBase').value,
      provider: $('#lmProvider').value,
      api_key: $('#lmApiKey').value,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Detect failed');
    const sel = $('#lmModel');
    const previous = sel.value;
    resetModelSelect();
    (data.models || []).forEach((id) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      sel.appendChild(opt);
    });
    if ((data.models || []).length) {
      sel.value = previous && (data.models || []).includes(previous) ? previous : data.models[0];
      $('#lmBase').value = data.base_url || $('#lmBase').value;
      $('#lmStatus').textContent = `${provider.label}: detected ${(data.models || []).length} model(s).`;
      saveSettings();
    } else $('#lmStatus').textContent = `${provider.label}: connection OK, but no models returned.`;
  } catch (err) {
    $('#lmStatus').textContent = err.message;
    toast(`${provider.label} detect failed`);
  }
}
$('#lmTestBtn').addEventListener('click', async () => {
  const provider = currentAiProvider();
  try {
    $('#lmStatus').textContent = `Testing ${provider.label} connection...`;
    const res = await api('/api/lm_models', {
      base_url: $('#lmBase').value,
      provider: $('#lmProvider').value,
      api_key: $('#lmApiKey').value,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Test failed');
    $('#lmStatus').textContent = (data.models || []).length
      ? `${provider.label} connection OK. ${(data.models || []).length} model(s) available.`
      : `${provider.label} connection OK, but no models returned.`;
    toast(`${provider.label} connection OK`);
  } catch (err) {
    $('#lmStatus').textContent = err.message;
    toast(`${provider.label} test failed`);
  }
});
function getScopeRange(scope) {
  const val = editor.value;
  if (scope === 'selection') {
    const s = editor.selectionStart,
      e = editor.selectionEnd;
    if (s === e) throw new Error('Select text first.');
    return { start: s, end: e, text: val.slice(s, e) };
  }
  if (scope === 'paragraph') {
    const r = currentParagraphRange();
    return { start: r.start, end: r.end, text: val.slice(r.start, r.end) };
  }
  return { start: 0, end: val.length, text: val };
}
function cleanPrompt() {
  const prompts = $('#promptSelect')._prompts || DEFAULT_PROMPTS;
  const prompt =
    prompts.find((p) => p.name === 'AI Cleanup — conservative') ||
    DEFAULT_PROMPTS.find((p) => p.name === 'AI Cleanup — conservative');
  return prompt.text;
}
function promptForTask(task) {
  return task === 'clean' ? cleanPrompt() : $('#promptText').value;
}
function rewriteStrength() {
  return $('#lmStrength')?.value || 'medium';
}
function optionalNumber(id) {
  const raw = $('#' + id)?.value.trim();
  if (!raw) return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function optionalInteger(id) {
  const raw = $('#' + id)?.value.trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
function advancedOptions() {
  const opts = {};
  const temperature = optionalNumber('advTemperature'),
    top_p = optionalNumber('advTopP'),
    top_k = optionalInteger('advTopK'),
    repeat_penalty = optionalNumber('advRepeatPenalty'),
    max_tokens = optionalInteger('advMaxTokens');
  if (temperature !== null) opts.temperature = temperature;
  if (top_p !== null) opts.top_p = top_p;
  if (top_k !== null) opts.top_k = top_k;
  if (repeat_penalty !== null) opts.repeat_penalty = repeat_penalty;
  if (max_tokens !== null) opts.max_tokens = max_tokens;
  return opts;
}
function guidedContext() {
  return { guidance: $('#guidedContext')?.value || '', target: $('#translateTarget')?.value || '' };
}
function chunkScope() {
  return selectedTextLength() ? 'selection' : 'whole';
}
$('#rewriteSelBtn').addEventListener('click', () => startLM('rewrite', 'selection', false));
$('#rewriteParaBtn').addEventListener('click', () => startLM('rewrite', 'paragraph', false));
$('#rewriteWholeBtn').addEventListener('click', () => startLM('rewrite', 'whole', false));
$('#rewriteChunkBtn').addEventListener('click', () => startLM('rewrite', chunkScope(), true));
$('#rewriteHeadingBtn').addEventListener('click', () => startLMSectioned('rewrite', chunkScope()));
$('#cleanSelBtn').addEventListener('click', () => startLM('clean', 'selection', false));
$('#cleanParaBtn').addEventListener('click', () => startLM('clean', 'paragraph', false));
$('#cleanWholeBtn').addEventListener('click', () => startLM('clean', 'whole', false));
$('#cleanChunkBtn').addEventListener('click', () => startLM('clean', chunkScope(), true));
$('#askImproveBtn').addEventListener('click', () => startGuidedAI('questions', 'selection'));
$('#feedbackOnlyBtn').addEventListener('click', () => startGuidedAI('feedback', 'selection'));
$('#rewriteGuidedBtn').addEventListener('click', () => startGuidedAI('guided-rewrite', 'selection'));
$('#translateSelBtn').addEventListener('click', () => startGuidedAI('translate', 'selection'));
$('#translateHeadingBtn').addEventListener('click', () => startGuidedSectioned('translate', chunkScope()));
export function setLmBusy(on) {
  [
    'rewriteSelBtn',
    'rewriteParaBtn',
    'rewriteWholeBtn',
    'rewriteChunkBtn',
    'rewriteHeadingBtn',
    'cleanSelBtn',
    'cleanParaBtn',
    'cleanWholeBtn',
    'cleanChunkBtn',
    'askImproveBtn',
    'feedbackOnlyBtn',
    'rewriteGuidedBtn',
    'translateSelBtn',
    'translateHeadingBtn',
  ].forEach((id) => {
    $('#' + id).disabled = on;
  });
}
function noteStreamFinish(info) {
  (info?.finishReasons || []).forEach((reason) => {
    if (!state.previewState.finishReasons) state.previewState.finishReasons = [];
    state.previewState.finishReasons.push(reason);
  });
}
function finishWarningText() {
  const reasons = state.previewState.finishReasons || [];
  if (reasons.includes('length'))
    return 'Warning: the provider stopped because the output hit a length limit; the last section may be incomplete.';
  if (reasons.includes('content_filter')) return 'Warning: the provider stopped because of a content filter.';
  return '';
}
export async function startLM(task, scope, chunked) {
  if (state.previewState.running) {
    toast('Generation is already running. Stop it first.');
    return;
  }
  try {
    const range = getScopeRange(scope);
    const promptText = promptForTask(task);
    if (!range.text.trim()) throw new Error('No text to send.');
    if (chunked) {
      await startLMChunked(task, scope, range, promptText);
      return;
    }
    const prep = prepareTextForLm(range.text);
    openPreview(`${task === 'clean' ? 'AI Clean' : 'Rewrite'} ${scope}`, range.text, '', range.start, range.end, true);
    state.previewState.expectedMarkers = markerSignature(range.text);
    noteStreamFinish(
      await streamOne(
        promptText,
        buildLmUserContent(prep.text, prep, task, rewriteStrength()),
        (txt) => {
          state.previewState.after += txt;
          updatePreview();
        },
        `${task} ${scope}`,
      ),
    );
    state.previewState.after = sanitizeLmFinalText(state.previewState.after);
    updatePreview();
    state.previewState.finished = true;
    state.previewState.running = false;
    const hasOutput = !!state.previewState.after.trim();
    $('#applyPreviewBtn').disabled = !hasOutput;
    setStopButtons(false);
    setLmBusy(false);
    $('#streamState').textContent = 'done';
    $('#previewStatus').textContent = hasOutput
      ? 'Generation complete.' + (finishWarningText() ? ' ' + finishWarningText() : '')
      : 'Generation produced no applicable text.';
    $('#lmStatus').textContent = $('#previewStatus').textContent;
    if (hasOutput) {
      renderIntegrityGuardrails(state.previewState.before, state.previewState.after);
      reportPreviewMarkerDrift();
    }
  } catch (err) {
    if (err?.name === 'AbortError' || state.previewState.partial) {
      markLmStopped();
      return;
    }
    toast(err.message);
    $('#lmStatus').textContent = err.message;
    finishPreviewError(err.message);
  }
}
async function startGuidedAI(kind, scope) {
  if (state.previewState.running) {
    toast('Generation is already running. Stop it first.');
    return;
  }
  try {
    const range = getScopeRange(scope);
    if (!range.text.trim()) throw new Error('No text to send.');
    const applyMode = kind === 'questions' || kind === 'feedback' ? 'none' : 'replace';
    const titles = {
      questions: 'Improve Questions',
      feedback: 'Feedback Only',
      'guided-rewrite': 'Rewrite with Guidance',
      translate: 'Translate Selection',
    };
    openPreview(titles[kind] || 'AI Tool', range.text, '', range.start, range.end, true, applyMode);
    state.previewState.expectedMarkers = applyMode === 'replace' ? markerSignature(range.text) : null;
    noteStreamFinish(
      await streamOne(
        guidedSystemPrompt(kind),
        guidedUserContent(kind, range.text, guidedContext()),
        (txt) => {
          state.previewState.after += txt;
          updatePreview();
        },
        kind,
      ),
    );
    state.previewState.after = sanitizeLmFinalText(state.previewState.after);
    updatePreview();
    state.previewState.finished = true;
    state.previewState.running = false;
    const hasOutput = !!state.previewState.after.trim();
    $('#applyPreviewBtn').disabled = applyMode === 'none' || !hasOutput;
    setStopButtons(false);
    setLmBusy(false);
    $('#streamState').textContent = 'done';
    $('#previewStatus').textContent =
      applyMode === 'none'
        ? 'Guidance complete. Review only; not applicable.'
        : hasOutput
          ? 'Generation complete.' + (finishWarningText() ? ' ' + finishWarningText() : '')
          : 'Generation produced no applicable text.';
    $('#lmStatus').textContent = $('#previewStatus').textContent;
    if (applyMode === 'replace' && hasOutput) {
      renderIntegrityGuardrails(state.previewState.before, state.previewState.after);
      reportPreviewMarkerDrift();
    }
  } catch (err) {
    if (err?.name === 'AbortError' || state.previewState.partial) {
      markLmStopped();
      return;
    }
    toast(err.message);
    $('#lmStatus').textContent = err.message;
    finishPreviewError(err.message);
  }
}
async function startLMSectioned(task, scope) {
  if (state.previewState.running) {
    toast('Generation is already running. Stop it first.');
    return;
  }
  try {
    const range = getScopeRange(scope);
    const promptText = promptForTask(task);
    if (!range.text.trim()) throw new Error('No text to send.');
    const maxChars = Math.max(1200, parseInt($('#chunkSize').value, 10) || 6000);
    const sections = makeHeadingSections(range.text, maxChars);
    openPreview(
      `${task === 'clean' ? 'AI Clean' : 'Rewrite'} by heading ${scope}`,
      range.text,
      '',
      range.start,
      range.end,
      true,
    );
    state.previewState.expectedMarkers = markerSignature(range.text);
    state.previewState.sectionSplitNote = headingSplitNote(sections);
    setPreviewProgress(0, sections.length);
    for (let i = 0; i < sections.length; i++) {
      if (!state.previewState.running) break;
      const pct = progressPercent(i, sections.length);
      $('#streamState').textContent = `${pct}% · section ${i + 1}/${sections.length}`;
      $('#previewStatus').textContent = `Generating heading section ${i + 1} of ${sections.length} (${pct}% done)...`;
      if (i > 0) state.previewState.after += '\n\n';
      const prep = prepareTextForLm(sections[i]);
      const info = await streamOne(
        promptText,
        buildLmUserContent(prep.text, prep, task, rewriteStrength()),
        (txt) => {
          state.previewState.after += txt;
          updatePreview();
        },
        `${task} heading section ${i + 1}/${sections.length}`,
      );
      noteStreamFinish(info);
      setPreviewProgress(i + 1, sections.length);
    }
    finishSectionedPreview('Heading-based generation');
  } catch (err) {
    if (err?.name === 'AbortError' || state.previewState.partial) {
      markLmStopped();
      return;
    }
    toast(err.message);
    $('#lmStatus').textContent = err.message;
    finishPreviewError(err.message);
  }
}
async function startGuidedSectioned(kind, scope) {
  if (state.previewState.running) {
    toast('Generation is already running. Stop it first.');
    return;
  }
  try {
    const range = getScopeRange(scope);
    if (!range.text.trim()) throw new Error('No text to send.');
    const maxChars = Math.max(1200, parseInt($('#chunkSize').value, 10) || 6000);
    const sections = makeHeadingSections(range.text, maxChars);
    const titles = { translate: 'Translate by Heading', 'guided-rewrite': 'Rewrite with Guidance by Heading' };
    openPreview(titles[kind] || 'AI by Heading', range.text, '', range.start, range.end, true, 'replace');
    state.previewState.expectedMarkers = markerSignature(range.text);
    state.previewState.sectionSplitNote = headingSplitNote(sections);
    setPreviewProgress(0, sections.length);
    for (let i = 0; i < sections.length; i++) {
      if (!state.previewState.running) break;
      const pct = progressPercent(i, sections.length);
      $('#streamState').textContent = `${pct}% · section ${i + 1}/${sections.length}`;
      $('#previewStatus').textContent = `Generating heading section ${i + 1} of ${sections.length} (${pct}% done)...`;
      if (i > 0) state.previewState.after += '\n\n';
      const info = await streamOne(
        guidedSystemPrompt(kind),
        guidedUserContent(kind, sections[i], guidedContext()),
        (txt) => {
          state.previewState.after += txt;
          updatePreview();
        },
        `${kind} heading section ${i + 1}/${sections.length}`,
      );
      noteStreamFinish(info);
      setPreviewProgress(i + 1, sections.length);
    }
    finishSectionedPreview('Heading-based generation');
  } catch (err) {
    if (err?.name === 'AbortError' || state.previewState.partial) {
      markLmStopped();
      return;
    }
    toast(err.message);
    $('#lmStatus').textContent = err.message;
    finishPreviewError(err.message);
  }
}
function finishSectionedPreview(label) {
  state.previewState.after = sanitizeLmFinalText(state.previewState.after);
  updatePreview();
  state.previewState.finished = !state.previewState.partial && state.previewState.running;
  state.previewState.running = false;
  setStopButtons(false);
  setLmBusy(false);
  const hasOutput = !!state.previewState.after.trim();
  const finalPct = state.previewState.progress?.percent ?? 0;
  $('#streamState').textContent = state.previewState.partial ? `stopped · ${finalPct}%` : 'done · 100%';
  $('#applyPreviewBtn').disabled = !!state.previewState.partial || !hasOutput;
  const notes = [state.previewState.sectionSplitNote, finishWarningText()].filter(Boolean).join(' ');
  $('#previewStatus').textContent = state.previewState.partial
    ? `Stopped at ${finalPct}%. Partial output is not applicable.`
    : hasOutput
      ? `${label} complete.${notes ? ' ' + notes : ''}`
      : `${label} produced no applicable text.${notes ? ' ' + notes : ''}`;
  $('#lmStatus').textContent = $('#previewStatus').textContent;
  if (!state.previewState.partial && hasOutput) {
    renderIntegrityGuardrails(state.previewState.before, state.previewState.after);
    reportPreviewMarkerDrift();
  }
}
async function startLMChunked(task, scope, range, promptText) {
  const maxChars = Math.max(1200, parseInt($('#chunkSize').value, 10) || 6000);
  const chunks = makeChunks(range.text, maxChars);
  openPreview(
    `${task === 'clean' ? 'AI Clean' : 'Rewrite'} chunked ${scope}`,
    range.text,
    '',
    range.start,
    range.end,
    true,
  );
  state.previewState.expectedMarkers = markerSignature(range.text);
  state.previewState.sectionSplitNote = chunks.largeParagraphCount
    ? `${chunks.largeParagraphCount} paragraph(s) were larger than Chunk size and were sent whole to avoid cutting a paragraph in half.`
    : '';
  setPreviewProgress(0, chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    if (!state.previewState.running) break;
    const pct = progressPercent(i, chunks.length);
    $('#streamState').textContent = `${pct}% · chunk ${i + 1}/${chunks.length}`;
    $('#previewStatus').textContent = `Generating chunk ${i + 1} of ${chunks.length} (${pct}% done)...`;
    if (i > 0) state.previewState.after += '\n\n';
    const prep = prepareTextForLm(chunks[i]);
    const info = await streamOne(
      promptText,
      buildLmUserContent(prep.text, prep, task, rewriteStrength()),
      (txt) => {
        state.previewState.after += txt;
        updatePreview();
      },
      `${task} chunk ${i + 1}/${chunks.length}`,
    );
    noteStreamFinish(info);
    setPreviewProgress(i + 1, chunks.length);
  }
  state.previewState.after = sanitizeLmFinalText(state.previewState.after);
  updatePreview();
  state.previewState.finished = !state.previewState.partial && state.previewState.running;
  state.previewState.running = false;
  setStopButtons(false);
  setLmBusy(false);
  const hasOutput = !!state.previewState.after.trim();
  const finalPct = state.previewState.progress?.percent ?? 0;
  const notes = [state.previewState.sectionSplitNote, finishWarningText()].filter(Boolean).join(' ');
  $('#streamState').textContent = state.previewState.partial ? `stopped · ${finalPct}%` : 'done · 100%';
  $('#applyPreviewBtn').disabled = !!state.previewState.partial || !hasOutput;
  $('#previewStatus').textContent = state.previewState.partial
    ? `Stopped at ${finalPct}%. Partial output is not applicable.`
    : hasOutput
      ? `Chunked generation complete.${notes ? ' ' + notes : ''}`
      : `Chunked generation produced no applicable text.${notes ? ' ' + notes : ''}`;
  $('#lmStatus').textContent = $('#previewStatus').textContent;
  if (!state.previewState.partial && hasOutput) {
    renderIntegrityGuardrails(state.previewState.before, state.previewState.after);
    reportPreviewMarkerDrift();
  }
}
const confirmedRemoteHosts = new Set();
function aiEndpointHost() {
  const raw = ($('#lmBase').value || '').trim() || currentAiProvider().base;
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname;
  } catch (e) {
    return '';
  }
}
function confirmRemoteEndpoint() {
  const host = aiEndpointHost();
  if (!host || isLocalEndpointHost(host) || confirmedRemoteHosts.has(host)) return;
  if (
    !confirm(
      `The AI endpoint "${host}" is not a local address. Your manuscript text will be sent to that server. Continue?`,
    )
  )
    throw new Error('Cancelled: the remote AI endpoint was not confirmed.');
  confirmedRemoteHosts.add(host);
}
async function streamOne(promptText, inputText, onText, label) {
  const provider = currentAiProvider();
  confirmRemoteEndpoint();
  state.lmAbort = new AbortController();
  setStopButtons(true);
  $('#showPreviewBtn').disabled = false;
  const info = { finishReasons: [], done: false, error: '' };
  const res = await fetch('/api/lm_stream', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({
      base_url: $('#lmBase').value,
      provider: $('#lmProvider').value,
      api_key: $('#lmApiKey').value,
      model: $('#lmModel').value,
      prompt: promptText,
      input: inputText,
      options: advancedOptions(),
    }),
    signal: state.lmAbort.signal,
  });
  if (!res.ok) {
    let msg = await res.text();
    try {
      msg = JSON.parse(msg).error || msg;
    } catch (e) {}
    throw new Error(msg || `${provider.label} request failed`);
  }
  let thinking = false,
    shownState = '';
  const parser = createNdjsonParser((ev) => {
    if (ev.t === 'delta') {
      if (thinking) {
        thinking = false;
        $('#streamState').textContent = shownState;
      }
      if (ev.text) onText(ev.text);
    } else if (ev.t === 'reasoning') {
      if (!thinking) {
        thinking = true;
        shownState = $('#streamState').textContent;
        $('#streamState').textContent = `${shownState} · thinking...`;
      }
    } else if (ev.t === 'finish') {
      info.finishReasons.push(ev.reason);
    } else if (ev.t === 'error') {
      info.error = ev.message || 'The AI provider reported an error.';
    } else if (ev.t === 'done') {
      info.done = true;
    }
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.end();
  if (!info.done)
    throw new Error(
      info.error || 'The AI stream ended before the provider finished. The output is incomplete and cannot be applied.',
    );
  return info;
}
