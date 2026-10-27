// Small text and file-name helpers.
export function cleanFilename(name) {
  return (name || 'manuscript').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '') || 'manuscript';
}
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
export function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export function removeOneIndent(line) {
  if (line.startsWith('\t')) return { line: line.slice(1), removed: 1 };
  const spaces = (line.match(/^ {1,4}/) || [''])[0].length;
  return { line: line.slice(spaces), removed: spaces };
}
export function isHtmlFile(file) {
  return /\.(html?|xhtml)$/i.test(file.name) || /^text\/html\b/i.test(file.type || '');
}
export function fileDisplaySize(size) {
  return typeof size === 'number' ? `${(size / 1024).toFixed(1)} kB` : '';
}
export function compareStats(text) {
  return `${String(text || '').length.toLocaleString()} chars · ${(String(text || '').match(/\S+/g) || []).length.toLocaleString()} words`;
}
export function isMergeableFile(file) {
  return /\.(txt|md|markdown|rtf|docx|doc|html|htm)$/i.test(file.name);
}
export function escapeHtml(s) {
  return String(s || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
export function progressPercent(done, total) {
  return total ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
}
