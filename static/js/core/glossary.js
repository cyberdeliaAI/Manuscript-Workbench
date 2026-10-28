// The project glossary: terms the AI must leave alone, and translations it must use.
//
//   Marta                          keep this term exactly as written
//   De Zeven Zussen => The Seven Sisters   use this translation when translating
//   # a comment                    ignored, like blank lines
//
// Terms are matched as whole words and case-sensitively (a name such as "Will" is not the verb "will").

const SEPARATOR = '=>';
const WORD = '[\\p{L}\\p{N}\\p{M}]';

/** Parses the glossary text. Lines that cannot be used are reported and skipped. */
export function parseGlossary(text) {
  const entries = [];
  const problems = [];
  const seen = new Map();
  String(text || '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const at = line.indexOf(SEPARATOR);
      const term = (at < 0 ? line : line.slice(0, at)).trim();
      const translation = at < 0 ? null : line.slice(at + SEPARATOR.length).trim();
      if (!term) {
        problems.push({ line: index + 1, message: 'a term is missing before "=>"' });
        return;
      }
      if (translation === '') {
        problems.push({ line: index + 1, message: `"${term}" has "=>" but no translation` });
        return;
      }
      const key = term.toLowerCase();
      if (seen.has(key)) {
        problems.push({ line: index + 1, message: `"${term}" is already on line ${seen.get(key)}` });
        return;
      }
      seen.set(key, index + 1);
      entries.push({ term, translation, line: index + 1 });
    });
  return { entries, problems };
}

function pattern(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!${WORD})${escaped}(?!${WORD})`, 'gu');
}

/** How often a term occurs as a whole word. */
export function countTerm(text, term) {
  if (!term) return 0;
  const found = String(text || '').match(pattern(term));
  return found ? found.length : 0;
}

/** The entries that matter for this text: those whose term (or translation) occurs in it. */
export function relevantEntries(entries, text) {
  return entries.filter((e) => countTerm(text, e.term) > 0 || (e.translation && countTerm(text, e.translation) > 0));
}

function isTranslation(task) {
  return task === 'translate';
}

/** The terms to leave alone for a task: plain entries, and both sides of a translation unless translating. */
function keptTerms(entries, task) {
  const kept = [];
  for (const e of entries) {
    if (e.translation === null) kept.push(e.term);
    else if (!isTranslation(task)) kept.push(e.term, e.translation);
  }
  return kept;
}

/** The glossary paragraph for a system prompt, or '' when nothing in `entries` needs saying. */
export function glossaryPromptBlock(entries, task) {
  if (!entries.length) return '';
  const lines = ['## Glossary'];
  const kept = keptTerms(entries, task);
  if (kept.length)
    lines.push(
      `Keep these terms exactly as written. Do not translate, rename, inflect, abbreviate or drop them: ${kept.map((t) => `"${t}"`).join(', ')}.`,
    );
  if (isTranslation(task)) {
    const translations = entries.filter((e) => e.translation !== null);
    if (translations.length) {
      lines.push('Always translate these terms as follows (every occurrence):');
      for (const e of translations) lines.push(`- "${e.term}" => "${e.translation}"`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

/** The system prompt with the glossary part that is relevant to `text` added. */
export function withGlossary(prompt, entries, task, text) {
  const block = glossaryPromptBlock(relevantEntries(entries || [], text), task);
  return block ? `${prompt}\n\n${block}` : prompt;
}

/**
 * Where the output breaks the glossary: a term that was kept in the input but occurs less often now, or a term
 * that should have been translated and was not. Returns short messages, and `terms`, the entries involved.
 */
export function glossaryIssues(before, after, entries, task) {
  const issues = [];
  const note = (message, term) => issues.push({ message, term });
  for (const term of keptTerms(entries || [], task)) {
    const was = countTerm(before, term);
    const now = countTerm(after, term);
    if (was && now < was) note(`"${term}" appears ${now}x instead of ${was}x`, term);
  }
  if (isTranslation(task)) {
    for (const e of entries || []) {
      if (e.translation === null) continue;
      const was = countTerm(before, e.term);
      if (!was) continue;
      const stillThere = countTerm(after, e.term);
      const used = countTerm(after, e.translation);
      if (stillThere) note(`"${e.term}" was not translated (expected "${e.translation}")`, e.term);
      else if (used < was)
        note(`"${e.translation}" appears ${used}x for "${e.term}" (${was}x in the original)`, e.term);
    }
  }
  return issues;
}

/**
 * Capitalised words that look like names: they occur at least once in the middle of a sentence (which keeps out
 * words that are only capitalised because they start one) and `minCount` times in all. Most frequent first.
 */
export function suggestNames(text, { minCount = 2, limit = 40, known = [] } = {}) {
  const source = String(text || '');
  const strip = (w) => w.replace(/['’][\p{L}]+$/u, '');
  const count = (re) => {
    const counts = new Map();
    let m;
    while ((m = re.exec(source))) counts.set(strip(m[0]), (counts.get(strip(m[0])) || 0) + 1);
    return counts;
  };
  const word = "\\p{Lu}[\\p{L}\\p{M}]{2,}(?:['’]\\p{L}+)?";
  const middle = count(new RegExp(`(?<=[\\p{Ll},;:]\\s)${word}`, 'gu'));
  const total = count(new RegExp(word, 'gu'));
  const skip = new Set(known.map((k) => k.toLowerCase()));
  return [...middle.keys()]
    .filter((w) => (total.get(w) || 0) >= minCount && !skip.has(w.toLowerCase()))
    .sort((a, b) => total.get(b) - total.get(a) || a.localeCompare(b))
    .slice(0, limit);
}
