// AI tab: provider setup and the entry points for rewrite/clean/guided/translate runs. The runs themselves are in
// ai-run.js, the request to the provider in ai-request.js.
import { state } from './state.js';
import { headingSplitNote, makeChunks, makeHeadingSections } from '../core/chunking.js';
import { withGlossary } from '../core/glossary.js';
import {
  DEFAULT_PROMPTS,
  buildLmUserContent,
  guidedSystemPrompt,
  guidedUserContent,
  prepareTextForLm,
} from '../core/prompts.js';
import { escapeHtml } from '../core/text-utils.js';
import { startRun } from './ai-run.js';
import { currentAiProvider } from './ai-request.js';
import { api } from './api.js';
import { $, editor, toast } from './dom.js';
import { currentParagraphRange, selectedTextLength } from './editor-ops.js';
import { saveSettings } from './settings.js';

export { currentAiProvider };
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
function maxChunkChars() {
  return Math.max(1200, parseInt($('#chunkSize').value, 10) || 6000);
}
/** The glossary part of a request: the entries and task that the preview was opened with. */
function withProjectGlossary(prompt, text) {
  return withGlossary(prompt, state.previewState.glossary, state.previewState.task, text);
}
function rewriteRequest(task, promptText) {
  const strength = rewriteStrength();
  return (source) => {
    const prep = prepareTextForLm(source);
    return {
      prompt: withProjectGlossary(promptText, prep.text),
      input: buildLmUserContent(prep.text, prep, task, strength),
    };
  };
}
function guidedRequest(kind) {
  const ctx = guidedContext();
  return (source) => ({
    prompt: withProjectGlossary(guidedSystemPrompt(kind), source),
    input: guidedUserContent(kind, source, ctx),
  });
}
function busy() {
  if (!state.previewState.running) return false;
  toast('Generation is already running. Stop it first.');
  return true;
}
function reportStartError(err) {
  toast(err.message);
  $('#lmStatus').textContent = err.message;
}
export async function startLM(task, scope, chunked) {
  if (busy()) return;
  try {
    const range = getScopeRange(scope);
    const promptText = promptForTask(task);
    if (!range.text.trim()) throw new Error('No text to send.');
    const name = task === 'clean' ? 'AI Clean' : 'Rewrite';
    const buildRequest = rewriteRequest(task, promptText);
    if (!chunked) {
      await startRun({ title: `${name} ${scope}`, range, sources: [range.text], task, noun: 'text', buildRequest });
      return;
    }
    const chunks = makeChunks(range.text, maxChunkChars());
    await startRun({
      title: `${name} chunked ${scope}`,
      range,
      sources: chunks,
      task,
      noun: 'chunk',
      label: 'Chunked generation',
      note: chunks.largeParagraphCount
        ? `${chunks.largeParagraphCount} paragraph(s) were larger than Chunk size and were sent whole to avoid cutting a paragraph in half.`
        : '',
      buildRequest,
    });
  } catch (err) {
    reportStartError(err);
  }
}
async function startLMSectioned(task, scope) {
  if (busy()) return;
  try {
    const range = getScopeRange(scope);
    const promptText = promptForTask(task);
    if (!range.text.trim()) throw new Error('No text to send.');
    const sections = makeHeadingSections(range.text, maxChunkChars());
    await startRun({
      title: `${task === 'clean' ? 'AI Clean' : 'Rewrite'} by heading ${scope}`,
      range,
      sources: sections,
      task,
      noun: 'section',
      label: 'Heading-based generation',
      note: headingSplitNote(sections),
      buildRequest: rewriteRequest(task, promptText),
    });
  } catch (err) {
    reportStartError(err);
  }
}
async function startGuidedAI(kind, scope) {
  if (busy()) return;
  try {
    const range = getScopeRange(scope);
    if (!range.text.trim()) throw new Error('No text to send.');
    const titles = {
      questions: 'Improve Questions',
      feedback: 'Feedback Only',
      'guided-rewrite': 'Rewrite with Guidance',
      translate: 'Translate Selection',
    };
    await startRun({
      title: titles[kind] || 'AI Tool',
      range,
      sources: [range.text],
      task: kind,
      applyMode: kind === 'questions' || kind === 'feedback' ? 'none' : 'replace',
      noun: 'text',
      buildRequest: guidedRequest(kind),
    });
  } catch (err) {
    reportStartError(err);
  }
}
async function startGuidedSectioned(kind, scope) {
  if (busy()) return;
  try {
    const range = getScopeRange(scope);
    if (!range.text.trim()) throw new Error('No text to send.');
    const sections = makeHeadingSections(range.text, maxChunkChars());
    const titles = { translate: 'Translate by Heading', 'guided-rewrite': 'Rewrite with Guidance by Heading' };
    await startRun({
      title: titles[kind] || 'AI by Heading',
      range,
      sources: sections,
      task: kind,
      noun: 'section',
      label: 'Heading-based generation',
      note: headingSplitNote(sections),
      buildRequest: guidedRequest(kind),
    });
  } catch (err) {
    reportStartError(err);
  }
}
