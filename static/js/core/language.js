// Language profiles: the typography rules that depend on the language of the manuscript.
//
// Profiles: `en` (English), `nl` (Nederlands) and `other` (any other language: only the language-neutral
// fixes are applied). The language comes from Book > Language, or is suggested from the text.

export const QUOTE_STYLES = {
  standard: { open: '“', close: '”', openSingle: '‘', closeSingle: '’' },
  'low-high': { open: '„', close: '”', openSingle: '‚', closeSingle: '’' },
};

export const PROFILES = {
  en: { id: 'en', label: 'English', quoteStyle: 'standard', dash: 'em', spaceBeforePunct: 'remove', elisions: true },
  nl: {
    id: 'nl',
    label: 'Nederlands',
    quoteStyle: 'standard',
    dash: 'spaced-en',
    spaceBeforePunct: 'remove',
    elisions: true,
  },
  other: {
    id: 'other',
    label: 'Other language',
    quoteStyle: 'standard',
    dash: 'em',
    spaceBeforePunct: 'keep',
    elisions: false,
  },
};

/** 'English', 'en-GB' -> 'en'; 'Nederlands', 'nl-BE' -> 'nl'; anything else -> 'other'; empty -> ''. */
export function normalizeLanguage(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (!v) return '';
  if (/^(en|eng|english|engels)$/.test(v) || /^en[-_]/.test(v)) return 'en';
  if (/^(nl|nld|dut|dutch|nederlands|vlaams)$/.test(v) || /^nl[-_]/.test(v)) return 'nl';
  return 'other';
}

/**
 * Resolves what the typography fixes should do. `opts.language` is a language name or code (empty means
 * English), `opts.quoteStyle` is 'auto' | 'standard' | 'low-high', `opts.dashStyle` is 'auto' | 'em' | 'spaced-en'.
 */
export function resolveTypography(opts = {}) {
  const profile = PROFILES[normalizeLanguage(opts.language) || 'en'];
  const quoteKey = QUOTE_STYLES[opts.quoteStyle] ? opts.quoteStyle : profile.quoteStyle;
  const dash = opts.dashStyle === 'em' || opts.dashStyle === 'spaced-en' ? opts.dashStyle : profile.dash;
  return {
    profile,
    quotes: QUOTE_STYLES[quoteKey],
    dash,
    spaceBeforePunct: profile.spaceBeforePunct,
    elisions: profile.elisions,
  };
}

// A straight or opening single quote that is really an apostrophe: English ('em, 'cause, 'tis, 'n', '90s) and
// Dutch ('s avonds, 't huis, 'n, 'k, 'm, 'r) elisions. The same rules exist in manuscript_workbench/preflight.py
// (tests/fixtures/parity.json keeps them equal).
const OPENER = '(^|[\\s([{—–-])';
export function elisionRules(quoteChar, elisions = true) {
  const decade = new RegExp(`${OPENER}${quoteChar}(?=\\d{2}s\\b)`, 'g');
  if (!elisions) return [decade];
  return [
    new RegExp(`${OPENER}${quoteChar}(?=(?:em|cause|til|tis|twas|n|round|bout|fore|gain|neath|cross)\\b)`, 'gi'),
    decade,
    new RegExp(`${OPENER}${quoteChar}(?=[stmkr]\\b)`, 'g'),
  ];
}

/** Replaces `quoteChar` with `apostrophe` wherever it is an elision. Returns the new text. */
export function replaceElisions(text, quoteChar, apostrophe, elisions = true) {
  let out = text;
  for (const re of elisionRules(quoteChar, elisions)) out = out.replace(re, `$1${apostrophe}`);
  return out;
}

/** Counts opening single quotes (‘) that are really apostrophes, e.g. Word's ‘t huis instead of ’t huis. */
export function countWrongApostrophes(text, language = '') {
  const { elisions } = resolveTypography({ language });
  let count = 0;
  for (const re of elisionRules('‘', elisions)) count += (text.match(re) || []).length;
  return count;
}

const EN_WORDS = new Set(
  'the and of to that it he she you with for as his her they be not from by this but we have said were all there would their what out about who them could into then only'.split(
    ' ',
  ),
);
const NL_WORDS = new Set(
  'de het een van dat niet hij zij ze ik je jij mijn zijn met voor aan ook maar als dan nog wel er om naar bij die dit deze wat wie hoe waar uit tot kan zou heeft werd ben bent wij hun hem zo nu toen weer geen alleen daar hier even al door op'.split(
    ' ',
  ),
);

function sampleText(text, size = 20000) {
  const s = String(text || '');
  if (s.length <= size * 3) return s;
  const mid = Math.floor(s.length / 2 - size / 2);
  return s.slice(0, size) + '\n' + s.slice(mid, mid + size) + '\n' + s.slice(s.length - size);
}

/**
 * Guesses the language from common function words. Returns { id: 'en' | 'nl' | '', confidence, en, nl };
 * an empty id means "not sure".
 */
export function detectLanguage(text) {
  const words =
    sampleText(text)
      .toLowerCase()
      .match(/[a-zà-ÿ]+/g) || [];
  let en = 0;
  let nl = 0;
  for (const w of words) {
    if (EN_WORDS.has(w)) en++;
    else if (NL_WORDS.has(w)) nl++;
  }
  const total = en + nl;
  if (total < 25) return { id: '', confidence: 0, en, nl };
  const confidence = Math.max(en, nl) / total;
  if (confidence < 0.7) return { id: '', confidence, en, nl };
  return { id: nl > en ? 'nl' : 'en', confidence, en, nl };
}
