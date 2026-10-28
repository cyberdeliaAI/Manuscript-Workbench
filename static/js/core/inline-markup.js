// Inline markup wrapping (bold, italic, [[u:..]] ...).
export function inlineWrapper(kind) {
  if (kind === 'italic') return { prefix: '*', suffix: '*' };
  if (kind === 'bold') return { prefix: '**', suffix: '**' };
  if (kind === 'mono') return { prefix: '`', suffix: '`' };
  return { prefix: `[[${kind}:`, suffix: ']]' };
}
export function countEdgeChars(text, char, fromStart) {
  let n = 0,
    i = fromStart ? 0 : text.length - 1;
  while (i >= 0 && i < text.length && text[i] === char) {
    n++;
    i += fromStart ? 1 : -1;
  }
  return n;
}
export function unwrapInlineText(text, kind) {
  const w = inlineWrapper(kind);
  let out = text,
    changed = false;
  if (kind === 'italic' && countEdgeChars(out, '*', true) === 2 && countEdgeChars(out, '*', false) === 2) return null;
  while (out.startsWith(w.prefix) && out.endsWith(w.suffix) && out.length >= w.prefix.length + w.suffix.length) {
    out = out.slice(w.prefix.length, out.length - w.suffix.length);
    changed = true;
    if (kind === 'italic' || kind === 'mono') break;
  }
  return changed ? out : null;
}
