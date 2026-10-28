// Rendered Markdown preview (rendered by the server).
import { state } from './state.js';
import { escapeHtml } from '../core/text-utils.js';
import { api } from './api.js';
import { $, editor } from './dom.js';

function setMarkdownPreviewHtml(html) {
  const pane = $('#markdownPreview');
  if (pane) pane.innerHTML = html || '<div class="empty">Preview appears here when text is loaded.</div>';
}
function previewIsVisible() {
  return document.querySelector('.editor-card')?.classList.contains('preview-on');
}
// Rendering happens on the server, so a big manuscript is given more time between requests.
function previewDelay() {
  const chars = state.analysis?.stats.chars || 0;
  return 160 + Math.min(4000, Math.floor(chars / 400));
}
export function renderMarkdownPreview() {
  const pane = $('#markdownPreview');
  if (!pane) return;
  clearTimeout(state.markdownPreviewTimer);
  if (!previewIsVisible()) return;
  const requestId = ++state.markdownPreviewRequest;
  state.markdownPreviewAbort?.abort(); // a request for an older version of the text is no longer interesting
  state.markdownPreviewTimer = setTimeout(async () => {
    const text = editor.value;
    if (!text.trim()) {
      setMarkdownPreviewHtml('');
      return;
    }
    state.markdownPreviewAbort = new AbortController();
    try {
      const res = await api('/api/render_markdown', { text }, { signal: state.markdownPreviewAbort.signal });
      if (!res.ok) throw new Error('Markdown renderer unavailable');
      const data = await res.json();
      if (requestId !== state.markdownPreviewRequest) return;
      setMarkdownPreviewHtml(data.html || '');
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (requestId === state.markdownPreviewRequest)
        setMarkdownPreviewHtml(`<div class="empty">Preview unavailable: ${escapeHtml(err.message || err)}</div>`);
    }
  }, previewDelay());
}
