// One pass over the whole text that produces everything the side panels and the line gutter show: statistics,
// diagnostics, outline, structure and a language suggestion. It is pure (text in, plain data out), so it runs
// in a Web Worker while the author types, and on the main thread as a fallback.
import { analyzeStructure } from './candidates.js';
import { diagnose } from './diagnostics.js';
import { detectLanguage } from './language.js';
import { headingOutline, markdownLineInfo } from './structure.js';
import { countWords } from './text-utils.js';

// What the gutter shows next to a line. One byte per line: 0 = nothing.
export const GUTTER_STRUCTURE = 1;
export const GUTTER_ENCODING = 2;
export const GUTTER_SPACING = 3;
export const GUTTER_CANDIDATE = 4;
export const GUTTER_TYPOGRAPHY = 5;
export const GUTTER_STYLES = {
  [GUTTER_STRUCTURE]: { className: 'issue', note: '' },
  [GUTTER_ENCODING]: { className: 'issue-violet', note: 'encoding/hidden character issue' },
  [GUTTER_SPACING]: { className: 'issue-rust', note: 'spacing issue' },
  [GUTTER_CANDIDATE]: { className: 'issue-amber', note: 'structure candidate' },
  [GUTTER_TYPOGRAPHY]: { className: 'issue-blue', note: 'typography spacing' },
};

/** The gutter code for a line, given the diagnostics flags (a Set of names) of that line. */
export function gutterCode(flags, line) {
  if (
    flags.has('mojibake') ||
    flags.has('invisible') ||
    flags.has('control') ||
    flags.has('specialSpace') ||
    flags.has('ligature')
  )
    return GUTTER_ENCODING;
  if (flags.has('trailingWs') || flags.has('tabs') || flags.has('extraBlank')) return GUTTER_SPACING;
  if (flags.has('wrap') || flags.has('pageNum') || flags.has('repeatLine')) return GUTTER_CANDIDATE;
  if (flags.has('doubleSpace') || flags.has('spaceBeforePunct') || flags.has('apostrophe')) return GUTTER_TYPOGRAPHY;
  if (markdownLineInfo(line) || /^\s*:::\s*[a-z0-9_-]*\s*$/i.test(line)) return GUTTER_STRUCTURE;
  return 0;
}

// Match lists as flat Int32Arrays [start0, end0, start1, end1, ...]: cheap to send between threads.
function compactMatches(matches) {
  const out = {};
  for (const [key, list] of Object.entries(matches)) {
    const flat = new Int32Array(list.length * 2);
    for (let i = 0; i < list.length; i++) {
      flat[2 * i] = list[i].start;
      flat[2 * i + 1] = list[i].end;
    }
    out[key] = flat;
  }
  return out;
}

/**
 * Options: { language, quoteStyle, dashStyle } (see core/language.js) and ignoredCandidates (an array of keys).
 * Returns { stats, diag: { positions, straightQuotes, curlyQuotes }, gutter, outline, structure, language }.
 */
export function analyzeText(text, options = {}) {
  const diag = diagnose(text, options);
  const lines = diag.lines;
  const gutter = new Uint8Array(lines.length);
  let chapters = 0;
  let subheads = 0;
  for (let i = 0; i < lines.length; i++) {
    gutter[i] = gutterCode(diag.flags[i], lines[i]);
    const h = /^\s{0,3}(#{1,6})[ \t]+\S/.exec(lines[i]);
    if (h) {
      if (h[1].length === 1) chapters++;
      else subheads++;
    }
  }
  return {
    stats: { chars: text.length, words: countWords(text), lines: lines.length, chapters, subheads },
    diag: {
      positions: compactMatches(diag.matches),
      straightQuotes: diag.straightQuotes,
      curlyQuotes: diag.curlyQuotes,
    },
    gutter,
    outline: headingOutline(text),
    structure: analyzeStructure(text, options.ignoredCandidates || []),
    language: detectLanguage(text).id,
  };
}

/** The buffers of a result that can be moved to the other thread instead of copied. */
export function transferables(result) {
  return [result.gutter.buffer, ...Object.values(result.diag.positions).map((a) => a.buffer)];
}
