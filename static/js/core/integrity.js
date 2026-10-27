// Content guardrails: compares AI output with its input.
import { stripInlineMarkup, stripStructureLine, wordCount } from './structure.js';

export const NAME_IGNORE = new Set(
  'A An And As At But By Chapter De Deel Dr For From He Her His I If In It Its Me Mr Mrs Ms My No Not Of On Or Our She Sir So The Their They This To We With You Your Een Het De Een En Van Voor Maar Als Dat Die Dit Deze Naar Zijn Haar Hij Zij Wij Jij U Ze There Then When Where'.split(
    /\s+/,
  ),
);
export function plainForIntegrity(text) {
  return stripInlineMarkup(
    String(text || '')
      .split('\n')
      .map(stripStructureLine)
      .join('\n'),
  ).replace(/[`*_~>#|[\]()]/g, ' ');
}
export function paragraphCount(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}
export function dialogueCount(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => line.trim().length > 1 && (/^\s*(?:["“‘'’-]|—)/.test(line) || /[“”]/.test(line))).length;
}
export function tokenSet(text, re) {
  const set = new Set();
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) set.add(m[0]);
  return set;
}
export function properNouns(text) {
  const clean = plainForIntegrity(text);
  const set = new Set();
  const re = /\b[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]{2,}(?:\s+[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]{2,}){0,2}\b/g;
  let m;
  while ((m = re.exec(clean))) {
    const name = m[0].trim();
    const first = name.split(/\s+/)[0];
    if (!NAME_IGNORE.has(first) && !NAME_IGNORE.has(name)) set.add(name);
  }
  return set;
}
export function setDiff(a, b) {
  return [...a].filter((x) => !b.has(x)).sort((x, y) => x.localeCompare(y));
}
export function analyzeIntegrity(before, after) {
  const bPlain = plainForIntegrity(before),
    aPlain = plainForIntegrity(after);
  const bWords = wordCount(bPlain),
    aWords = wordCount(aPlain);
  const ratio = bWords ? aWords / bWords : 1;
  const bPara = paragraphCount(before),
    aPara = paragraphCount(after);
  const bDialog = dialogueCount(before),
    aDialog = dialogueCount(after);
  const bNames = properNouns(before),
    aNames = properNouns(after);
  const missingNames = setDiff(bNames, aNames),
    addedNames = setDiff(aNames, bNames);
  const numberRe =
    /\b(?:\d+(?:[.,:/-]\d+)*|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\b/gi;
  const bNums = tokenSet(bPlain, numberRe),
    aNums = tokenSet(aPlain, numberRe);
  const missingNums = setDiff(bNums, aNums),
    addedNums = setDiff(aNums, bNums);
  const issues = [];
  const facts = [];
  facts.push(`${bWords.toLocaleString()} → ${aWords.toLocaleString()} words`);
  facts.push(`${bPara} → ${aPara} paragraphs`);
  if (ratio < 0.7 || ratio > 1.3) issues.push(`length changed ${Math.round((ratio - 1) * 100)}%`);
  if (bPara && Math.abs(aPara - bPara) > Math.max(2, Math.ceil(bPara * 0.25)))
    issues.push(`paragraph count changed ${bPara} → ${aPara}`);
  if (bDialog && Math.abs(aDialog - bDialog) > Math.max(2, Math.ceil(bDialog * 0.25)))
    issues.push(`dialogue lines changed ${bDialog} → ${aDialog}`);
  if (missingNames.length)
    issues.push(`names missing: ${missingNames.slice(0, 6).join(', ')}${missingNames.length > 6 ? '...' : ''}`);
  if (addedNames.length >= 3)
    issues.push(`new names: ${addedNames.slice(0, 6).join(', ')}${addedNames.length > 6 ? '...' : ''}`);
  if (missingNums.length)
    issues.push(`numbers/dates missing: ${missingNums.slice(0, 8).join(', ')}${missingNums.length > 8 ? '...' : ''}`);
  if (addedNums.length >= 3)
    issues.push(`new numbers/dates: ${addedNums.slice(0, 8).join(', ')}${addedNums.length > 8 ? '...' : ''}`);
  return { issues, facts };
}
