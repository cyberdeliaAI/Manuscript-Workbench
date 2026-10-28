// One streaming request to the AI provider, through the app's own /api/lm_stream proxy.
import { state } from './state.js';
import { AI_PROVIDERS, createNdjsonParser, isLocalEndpointHost } from '../core/ai-stream.js';
import { apiHeaders } from './api.js';
import { $ } from './dom.js';

export function currentAiProvider() {
  return AI_PROVIDERS[$('#lmProvider')?.value] || AI_PROVIDERS.custom;
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
  ) {
    const err = new Error('Cancelled: the remote AI endpoint was not confirmed.');
    err.fatal = true; // trying again would only ask the same question
    throw err;
  }
  confirmedRemoteHosts.add(host);
}

/**
 * Sends one request and calls `onText` for every piece of visible text. Resolves with { finishReasons } when the
 * provider finished cleanly; rejects when the request failed or the stream ended early. `state.lmAbort` cancels it.
 */
export async function streamOne(promptText, inputText, onText) {
  const provider = currentAiProvider();
  confirmRemoteEndpoint();
  state.lmAbort = new AbortController();
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
