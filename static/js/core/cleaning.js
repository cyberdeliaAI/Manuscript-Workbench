// Clean operations. All of them are pure text-in, text-out functions.
import { isLikelyPageNumberLine, repeatedLineCandidates, shouldJoinLines } from './line-heuristics.js';
import { fixMojibake } from './mojibake.js';
import { replaceElisions, resolveTypography } from './language.js';

export const DESTRUCTIVE_FIXES = new Set([
  'htmlText',
  'join',
  'blankRuns',
  'pageNumbers',
  'repeatLines',
  'indentation',
  'spaceAfterPunct',
  'quotesCurly',
  'apostrophes',
  'quotesStraight',
  'dashEm',
  'ellipsis',
]);
export const SAFE_FIX_SEQUENCE = [
  'mojibake',
  'invisible',
  'specialSpaces',
  'controlChars',
  'unicodeNFC',
  'ligatures',
  'tabsToSpace',
  'trailingSpaces',
  'collapseSpaces',
  'spaceBeforePunct',
  'trimDoc',
];
export const FIX_LABELS = {
  mojibake: 'Repair mojibake',
  invisible: 'Remove invisible characters',
  specialSpaces: 'Normalize special spaces',
  controlChars: 'Strip control characters',
  unicodeNFC: 'Normalize Unicode composition',
  ligatures: 'Replace typographic ligatures',
  join: 'Join wrapped lines conservatively',
  blankRuns: 'Normalize blank lines',
  trailingSpaces: 'Trim trailing spaces',
  indentation: 'Remove indentation',
  pageNumbers: 'Remove standalone page-number lines',
  repeatLines: 'Remove repeated header/footer candidates',
  tabsToSpace: 'Tabs to spaces',
  collapseSpaces: 'Collapse multiple spaces',
  spaceBeforePunct: 'Remove space before punctuation',
  spaceAfterPunct: 'Add missing space after punctuation',
  quotesCurly: 'Convert quotes to curly',
  apostrophes: 'Repair apostrophes',
  quotesStraight: 'Convert quotes to straight',
  dashEm: 'Convert double hyphen to dash',
  ellipsis: 'Convert three dots to ellipsis',
  trimDoc: 'Trim document edges',
  htmlText: 'Extract text from HTML',
};
export function fixInvisible(text) {
  return text.replace(/[\u200B\u200C\u200D\u2060\uFEFF\u00AD]/g, '');
}
export function fixSpecialSpaces(text) {
  return text.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
}
export function fixControlChars(text) {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
export function fixUnicodeNFC(text) {
  return text.normalize('NFC');
}
export function fixLigatures(text) {
  return text
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB05/g, 'st')
    .replace(/\uFB06/g, 'st');
}
export function fixJoin(text, opts) {
  const lines = text.split('\n'),
    out = [];
  let buffer = null;
  for (const raw of lines) {
    if (raw.trim() === '') {
      if (buffer !== null) {
        out.push(buffer);
        buffer = null;
      }
      out.push('');
      continue;
    }
    if (buffer === null) {
      buffer = raw.trim();
      continue;
    }
    if (shouldJoinLines(buffer, raw)) {
      buffer =
        opts.dehyphenate && /[A-Za-zÀ-ÖØ-öø-ÿ]-$/.test(buffer)
          ? buffer.replace(/-$/, '') + raw.trim()
          : buffer + ' ' + raw.trim();
    } else {
      out.push(buffer);
      buffer = raw.trim();
    }
  }
  if (buffer !== null) out.push(buffer);
  return out.join('\n');
}
export function fixBlankRuns(text) {
  return text.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');
}
export function fixTrailingSpaces(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n');
}
export function fixIndentation(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/^[ \t]+/, ''))
    .join('\n');
}
export function fixPageNumbers(text) {
  const lines = text.split('\n');
  return lines.filter((l, idx) => !isLikelyPageNumberLine(l, idx, lines)).join('\n');
}
export function fixRepeatedLines(text) {
  const lines = text.split('\n');
  const remove = repeatedLineCandidates(lines);
  return lines.filter((_, idx) => !remove.has(idx)).join('\n');
}
export function fixTabsToSpace(text) {
  return text.replace(/\t/g, ' ');
}
export function fixCollapseSpaces(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/(?<=\S) {2,}/g, ' '))
    .join('\n');
}
export function fixSpaceBeforePunct(text, opts = {}) {
  if (resolveTypography(opts).spaceBeforePunct === 'keep') return text; // e.g. French puts a space before : ; ! ?
  return text.replace(/ +([,.;:!?])/g, '$1');
}
export function fixSpaceAfterPunct(text) {
  return text
    .replace(/([a-zà-ÿ]{2})([.!?])([A-ZÀ-Ý])(?=[a-zà-ÿ])/g, '$1$2 $3')
    .replace(/([a-zà-ÿ]),([a-zà-ÿA-ZÀ-Ý])/g, '$1, $2');
}
export function fixQuotesCurly(text, opts = {}) {
  const { quotes, elisions } = resolveTypography(opts);
  return replaceElisions(text, "'", '’', elisions)
    .replace(/(^|[\s([{—–-])"/g, `$1${quotes.open}`)
    .replace(/"/g, quotes.close)
    .replace(/(^|[\s([{—–-])'/g, `$1${quotes.openSingle}`)
    .replace(/'/g, quotes.closeSingle);
}
/** Opening single quotes that are really apostrophes (‘t huis, ‘s avonds, ‘em) become closing ones (’). */
export function fixApostrophes(text, opts = {}) {
  return replaceElisions(text, '‘', '’', resolveTypography(opts).elisions);
}
export function fixQuotesStraight(text) {
  return text.replace(/[“”„]/g, '"').replace(/[‘’‚]/g, "'");
}
export function isDashProtectedLine(line) {
  return /^\s*[-–—]{3,}\s*$/.test(line) || /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}
function convertDashesEm(line) {
  return line.replace(/(^|[^-])---(?!-)/g, '$1—').replace(/(^|[^-])--(?!-)/g, '$1—');
}
// Dutch typography: a spaced en dash ("woord – woord"); at the start of a line it marks dialogue.
function convertDashesSpacedEn(line) {
  return line.replace(/[ \t]*(?<!-)(?:---|--)(?!-)[ \t]*/g, (match, offset, whole) => {
    const atStart = whole.slice(0, offset).trim() === '';
    const atEnd = whole.slice(offset + match.length).trim() === '';
    if (atStart && atEnd) return '–';
    if (atStart) return '– ';
    if (atEnd) return ' –';
    return ' – ';
  });
}
export function fixDashEm(text, opts = {}) {
  const convert = resolveTypography(opts).dash === 'spaced-en' ? convertDashesSpacedEn : convertDashesEm;
  return text
    .split('\n')
    .map((line) => (isDashProtectedLine(line) ? line : convert(line)))
    .join('\n');
}
export function fixEllipsis(text) {
  return text.replace(/\.\s+\.\s+\./g, '…').replace(/\.{3}/g, '…');
}
export function fixHtmlText(text) {
  if (!/<[a-z!/][\s\S]*>/i.test(text) && !/&(?:[a-z][a-z0-9]+|#\d+|#x[0-9a-f]+);/i.test(text)) return text;
  const doc = new DOMParser().parseFromString(text, 'text/html');
  doc
    .querySelectorAll(
      'script,style,noscript,template,svg,canvas,nav,header,footer,aside,form,menu,.sidebar,.navigation,.menu,.footer,.header,#sidebar,#navigation,#menu,#footer,#header',
    )
    .forEach((el) => el.remove());
  const selectors = [
    'main',
    'article',
    '[role="main"]',
    '#content',
    '#main',
    '#article',
    '.content',
    '.post',
    '.entry',
  ];
  let root = null;
  selectors.forEach((sel) => {
    doc.querySelectorAll(sel).forEach((el) => {
      if (!root || (el.textContent || '').length > (root.textContent || '').length) root = el;
    });
  });
  root = root || doc.body;
  const blocks = new Set([
    'address',
    'article',
    'blockquote',
    'body',
    'dd',
    'details',
    'dialog',
    'div',
    'dl',
    'dt',
    'fieldset',
    'figcaption',
    'figure',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'li',
    'main',
    'ol',
    'p',
    'pre',
    'section',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'ul',
  ]);
  const skip = new Set([
    'script',
    'style',
    'noscript',
    'template',
    'svg',
    'canvas',
    'nav',
    'header',
    'footer',
    'aside',
    'form',
    'menu',
  ]);
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (
      node.nodeType !== Node.ELEMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_NODE
    )
      return '';
    const tag = (node.tagName || '').toLowerCase();
    if (skip.has(tag)) return '';
    if (tag === 'br') return '\n';
    let inner = '';
    node.childNodes.forEach((child) => {
      inner += walk(child);
    });
    if (tag === 'td' || tag === 'th') return `\n${inner}\t`;
    if (blocks.has(tag)) return `\n${inner}\n`;
    return inner;
  };
  return walk(root)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export function fixTrimDoc(text) {
  return text.trim();
}
export const FIXES = {
  mojibake: fixMojibake,
  invisible: fixInvisible,
  specialSpaces: fixSpecialSpaces,
  controlChars: fixControlChars,
  unicodeNFC: fixUnicodeNFC,
  ligatures: fixLigatures,
  htmlText: fixHtmlText,
  join: fixJoin,
  blankRuns: fixBlankRuns,
  trailingSpaces: fixTrailingSpaces,
  indentation: fixIndentation,
  pageNumbers: fixPageNumbers,
  repeatLines: fixRepeatedLines,
  tabsToSpace: fixTabsToSpace,
  collapseSpaces: fixCollapseSpaces,
  spaceBeforePunct: fixSpaceBeforePunct,
  spaceAfterPunct: fixSpaceAfterPunct,
  quotesCurly: fixQuotesCurly,
  apostrophes: fixApostrophes,
  quotesStraight: fixQuotesStraight,
  dashEm: fixDashEm,
  ellipsis: fixEllipsis,
  trimDoc: fixTrimDoc,
};
export function safeCleanup(text, opts = { dehyphenate: true }) {
  let out = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const id of SAFE_FIX_SEQUENCE) {
    out = FIXES[id](out, opts);
  }
  return out;
}
