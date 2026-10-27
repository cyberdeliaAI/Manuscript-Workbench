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
export function renderMarkdownPreview() {
  const pane = $('#markdownPreview');
  if (!pane) return;
  if (!previewIsVisible()) {
    clearTimeout(state.markdownPreviewTimer);
    return;
  }
  const text = editor.value;
  const requestId = ++state.markdownPreviewRequest;
  if (!text.trim()) {
    clearTimeout(state.markdownPreviewTimer);
    setMarkdownPreviewHtml('');
    return;
  }
  clearTimeout(state.markdownPreviewTimer);
  state.markdownPreviewTimer = setTimeout(async () => {
    try {
      const res = await api('/api/render_markdown', { text });
      if (!res.ok) throw new Error('Markdown renderer unavailable');
      const data = await res.json();
      if (requestId !== state.markdownPreviewRequest) return;
      setMarkdownPreviewHtml(data.html || '');
    } catch (err) {
      if (requestId === state.markdownPreviewRequest)
        setMarkdownPreviewHtml(`<div class="empty">Preview unavailable: ${escapeHtml(err.message || err)}</div>`);
    }
  }, 160);
}
