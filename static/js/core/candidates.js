// Structure analysis for the Markdown tab: the marked structure of a text and the unmarked lines that look like
// chapter or front/back-matter titles ("candidates"), which the author can mark or ignore.
import { MD_STYLE_INFO, canonicalStructureMarker, isChapterCandidate, markdownLineInfo } from './structure.js';

/** Identifies a candidate regardless of case and spacing. manuscript_workbench/preflight.py has the same rule. */
export function candidateKey(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Walks the text once. Returns the structure rows (marked lines and `::: block` content), the counts, and the
 * candidates split into those still to decide (`candidates`) and those the author chose to `ignored`.
 * Every candidate is { line (1-based), text, key }.
 */
export function analyzeStructure(text, ignoredKeys = []) {
  const ignoredSet = new Set(ignoredKeys.map(candidateKey));
  const rows = [];
  const candidates = [];
  const ignored = [];
  let chapters = 0;
  let subheads = 0;
  let special = 0;
  let blockMarker = '';
  String(text || '')
    .split('\n')
    .forEach((line, idx) => {
      const container = line.match(/^\s*:::\s*([a-z0-9_-]+)?\s*$/i);
      if (container) {
        blockMarker = canonicalStructureMarker(container[1] || '');
        return;
      }
      const md = markdownLineInfo(line);
      const clean = md ? md.content : line.trim();
      let marker = md?.marker || '';
      if (!marker && blockMarker && clean) marker = blockMarker;
      if (marker) {
        const info = MD_STYLE_INFO[marker] || [marker.toUpperCase(), 'supp'];
        rows.push({ line: idx + 1, marker, text: clean || '(empty marker)', tag: info[0], group: info[1] });
        if (info[1] === 'chapter') chapters++;
        else if (info[1] === 'sub') subheads++;
        else special++;
        return;
      }
      if (clean && isChapterCandidate(clean)) {
        const candidate = { line: idx + 1, text: clean, key: candidateKey(clean) };
        (ignoredSet.has(candidate.key) ? ignored : candidates).push(candidate);
      }
    });
  return { chapters, subheads, special, rows, candidates, ignored };
}

/** Marks the given lines (1-based) as `# ` (level 'h1', the default) or `## ` (level 'h2'). Returns the new text. */
export function markCandidateLines(text, lineNumbers, level = 'h1') {
  const prefix = level === 'h2' ? '## ' : '# ';
  const wanted = new Set(lineNumbers);
  return String(text || '')
    .split('\n')
    .map((line, i) => (wanted.has(i + 1) && line.trim() ? prefix + line.trim() : line))
    .join('\n');
}
