'use strict';
// Computes a JSON-serialisable snapshot of the observable behaviour of the client-side logic.
// tests/tools/generate_golden_js.js stores it; legacy_snapshot.test.js compares against it.

function plain(value) {
  return JSON.parse(JSON.stringify(value, (_k, v) => (Object.prototype.toString.call(v) === '[object Set]' ? [...v].sort() : v)));
}

// Deterministic JSON with every non-ASCII character written as a \uXXXX escape (keeps invisible characters
// visible in diffs of the golden file).
function stableStringify(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    return v;
  };
  const json = JSON.stringify(sort(value), null, 2);
  let out = '';
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    out += code > 126 ? String.fromCharCode(92) + 'u' + code.toString(16).padStart(4, '0') : json[i];
  }
  return out + '\n';
}

const SANITIZE_LM_CASES = [
  '<think>x</think>Answer',
  '```markdown\n# T\ntext\n```',
  "Here is the rewritten text:\n\nBody",
  'Plain output',
  'Hier is de herschreven tekst:\n\nInhoud',
];
const SCENE_CASES = ['***', '* * *', '---', '- - -', '~~~', '###', '#', '###a', '•••', 'text', ''];
const JOIN_CASES = [
  ['The sentence continues here and goes on', 'with the next line of the text.'],
  ['A complete sentence.', 'Next sentence begins.'],
  ['CHAPTER ONE', 'text that follows'],
  ['short', 'line'],
  ['This line ends with a hyphen inter-', 'national and continues.'],
  ['A long line that is not finished and keeps going on and on', '- list item'],
];
const INLINE_CASES = [['*it*', 'italic'], ['**bo**', 'bold'], ['***bi***', 'italic'], ['[[u:x]]', 'u'], ['`m`', 'mono'], ['plain', 'bold']];

function computeSnapshot(api, corpus) {
  const snap = { fixes: {}, diagnose: {}, structure: {}, chunks: {}, integrity: {}, misc: {} };
  const fixIds = Object.keys(api.FIXES).filter((id) => id !== 'htmlText').sort();
  for (const name of Object.keys(corpus).sort()) {
    const text = corpus[name];
    const fixes = {};
    for (const id of fixIds) fixes[id] = api.FIXES[id](text, { dehyphenate: true });
    fixes.safeCleanup = api.safeCleanup(text);
    snap.fixes[name] = fixes;

    const d = api.diagnose(text);
    const counts = {};
    for (const [k, v] of Object.entries(d.matches)) counts[k] = v.length;
    const flagged = [];
    d.flags.forEach((f, i) => { if (f.size) flagged.push([i, [...f].sort()]); });
    snap.diagnose[name] = { counts, flagged, straightQuotes: d.straightQuotes, curlyQuotes: d.curlyQuotes };

    snap.structure[name] = {
      lineInfo: text.split('\n').map((l) => plain(api.markdownLineInfo(l))),
      stripped: api.stripMarkers(text),
      outline: plain(api.headingOutline(text)),
      signature: api.structureSignature(text),
    };

    const chunks = api.makeChunks(text, 300);
    const sections = api.makeHeadingSections(text, 300);
    snap.chunks[name] = {
      chunks: [...chunks], largeParagraphs: chunks.largeParagraphCount,
      sections: [...sections], oversized: sections.oversizedCount, largeInSections: sections.largeParagraphCount, original: sections.originalCount,
    };

    snap.integrity[name] = {
      vs_safe_cleanup: plain(api.analyzeIntegrity(text, fixes.safeCleanup)),
      vs_upper: plain(api.analyzeIntegrity(text, text.toUpperCase())),
      vs_half: plain(api.analyzeIntegrity(text, text.slice(0, Math.floor(text.length / 2)))),
    };
  }
  snap.misc = {
    sanitizeLmFinalText: SANITIZE_LM_CASES.map((s) => [s, api.sanitizeLmFinalText(s)]),
    isSceneBreak: SCENE_CASES.map((s) => [s, api.isSceneBreak(s)]),
    shouldJoinLines: JOIN_CASES.map(([a, b]) => [a, b, api.shouldJoinLines(a, b)]),
    unwrapInlineText: INLINE_CASES.map(([s, k]) => [s, k, api.unwrapInlineText(s, k)]),
    escapeHtml: api.escapeHtml('<a href="x">&\'</a>'),
    cleanFilename: ['My Book: Part 1!', '', '../x', 'ok-name_1.2'].map((s) => [s, api.cleanFilename(s)]),
    safeFixSequence: [...api.SAFE_FIX_SEQUENCE],
    destructiveFixes: [...api.DESTRUCTIVE_FIXES].sort(),
    canonical: ['note', 'text', 'image', 'Verse', '', 'caption'].map((s) => [s, api.canonicalStructureMarker(s)]),
  };
  return plain(snap);
}

module.exports = { computeSnapshot, plain, stableStringify };
