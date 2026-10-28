// Preflight panel.
import { state } from './state.js';
import { escapeHtml } from '../core/text-utils.js';
import { api } from './api.js';
import { $, editor } from './dom.js';
import { jumpToLine } from './editor-ops.js';
import { effectiveLanguage } from './language.js';
import { getMetadata } from './settings.js';

$('#preflightBtn').addEventListener('click', runPreflight);
async function runPreflight() {
  const metadata = getMetadata();
  // the checks judge typography by the language the Clean tools use: the chosen one, else the suggested one
  metadata.language = metadata.language || effectiveLanguage();
  const res = await api('/api/preflight', {
    text: editor.value,
    metadata,
    ignored_candidates: state.ignoredCandidates,
  });
  const data = await res.json();
  renderPreflight(data);
}
function renderPreflight(data) {
  const s = data.summary || {};
  $('#preflightSummary').innerHTML =
    `<span class="${s.error ? 'err' : 'ok'}">${s.error || 0} errors</span> · <span class="${s.warning ? 'warn' : 'ok'}">${s.warning || 0} warnings</span> · ${data.wordCount || 0} words · ${data.lineCount || 0} lines`;
  const list = $('#issueList');
  list.innerHTML = '';
  if (!(data.issues || []).length) {
    list.innerHTML = '<div class="hint ok">No preflight issues found.</div>';
    return;
  }
  (data.issues || []).forEach((issue) => {
    const div = document.createElement('div');
    div.className = 'issue';
    div.innerHTML = `<div class="top"><span class="dot ${issue.level}"></span><span class="msg">${escapeHtml(issue.message)} ${issue.count > 1 ? `<b>(${issue.count})</b>` : ''}</span>${issue.line ? `<button class="mini">line ${issue.line}</button>` : ''}</div>${issue.sample ? `<div class="sample">${escapeHtml(issue.sample)}</div>` : ''}`;
    if (issue.line) {
      div.querySelector('button').addEventListener('click', () => jumpToLine(issue.line));
    }
    list.appendChild(div);
  });
}
