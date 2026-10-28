// Diagnostics: finds cleanup candidates in a text.
import { isLikelyPageNumberLine, repeatedLineCandidates, shouldJoinLines } from './line-heuristics.js';
import { SIG_RE_G } from './mojibake.js';
import { elisionRules, resolveTypography } from './language.js';

export function markLine(offs, count, pos, flags, flagName) {
  let lo = 0,
    hi = count - 1,
    li = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offs[mid] <= pos) {
      li = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (flags[li]) flags[li].add(flagName);
}
export function diagnose(text, opts = {}) {
  const typography = resolveTypography(opts);
  const lines = text.split('\n');
  const flags = lines.map(() => new Set());
  const matches = {
    wrap: [],
    trailingWs: [],
    tabs: [],
    doubleSpace: [],
    spaceBeforePunct: [],
    apostrophe: [],
    extraBlank: [],
    doubleHyphen: [],
    tripleDot: [],
    mojibake: [],
    specialSpace: [],
    invisible: [],
    control: [],
    pageNum: [],
    repeatLine: [],
    ligature: [],
  };
  const offs = [];
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    offs.push(acc);
    acc += lines[i].length + 1;
  }
  const repeatCandidates = repeatedLineCandidates(lines);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      lineStart = offs[i],
      lineEnd = lineStart + line.length;
    if (line.trim() === '') continue;
    if (i > 0 && shouldJoinLines(lines[i - 1], line)) {
      flags[i].add('wrap');
      matches.wrap.push({ start: lineStart, end: lineEnd });
    }
    const tw = line.match(/[ \t]+$/);
    if (tw) {
      flags[i].add('trailingWs');
      matches.trailingWs.push({ start: lineStart + tw.index, end: lineEnd });
    }
    let idx = line.indexOf('\t');
    while (idx !== -1) {
      flags[i].add('tabs');
      matches.tabs.push({ start: lineStart + idx, end: lineStart + idx + 1 });
      idx = line.indexOf('\t', idx + 1);
    }
    let m;
    const dsRe = /(?<=\S) {2,}/g;
    while ((m = dsRe.exec(line))) {
      flags[i].add('doubleSpace');
      matches.doubleSpace.push({ start: lineStart + m.index, end: lineStart + m.index + m[0].length });
    }
    if (typography.spaceBeforePunct === 'remove') {
      const sbRe = / +[,.;:!?]/g;
      while ((m = sbRe.exec(line))) {
        flags[i].add('spaceBeforePunct');
        matches.spaceBeforePunct.push({ start: lineStart + m.index, end: lineStart + m.index + m[0].length });
      }
    }
    if (isLikelyPageNumberLine(line, i, lines)) {
      flags[i].add('pageNum');
      matches.pageNum.push({ start: lineStart, end: lineEnd });
    }
    if (repeatCandidates.has(i)) {
      flags[i].add('repeatLine');
      matches.repeatLine.push({ start: lineStart, end: lineEnd });
    }
  }
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      let j = i;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j - i >= 2) {
        for (let k = i + 1; k < j; k++) {
          flags[k].add('extraBlank');
          matches.extraBlank.push({ start: offs[k], end: offs[k] });
        }
      }
      i = j;
    } else i++;
  }
  let m;
  const dhRe = /(^|[^-])--(?!-)/g;
  while ((m = dhRe.exec(text)))
    matches.doubleHyphen.push({ start: m.index + (m[1] ? m[1].length : 0), end: m.index + m[0].length });
  const tdRe = /\.{3}/g;
  while ((m = tdRe.exec(text))) matches.tripleDot.push({ start: m.index, end: m.index + m[0].length });
  const ligRe = /[\uFB00-\uFB06]/g;
  while ((m = ligRe.exec(text))) {
    matches.ligature.push({ start: m.index, end: m.index + 1 });
    markLine(offs, lines.length, m.index, flags, 'ligature');
  }
  for (const re of elisionRules('‘', typography.elisions)) {
    // an opening quote that is really an apostrophe (‘t huis); group 1 is the character before it
    while ((m = re.exec(text))) {
      const at = m.index + m[1].length;
      matches.apostrophe.push({ start: at, end: at + 1 });
      markLine(offs, lines.length, at, flags, 'apostrophe');
    }
  }
  matches.apostrophe.sort((a, b) => a.start - b.start);
  SIG_RE_G.lastIndex = 0;
  while ((m = SIG_RE_G.exec(text))) {
    matches.mojibake.push({ start: m.index, end: m.index + m[0].length });
    markLine(offs, lines.length, m.index, flags, 'mojibake');
  }
  const ssRe = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
  while ((m = ssRe.exec(text))) {
    matches.specialSpace.push({ start: m.index, end: m.index + 1 });
    markLine(offs, lines.length, m.index, flags, 'specialSpace');
  }
  const invRe = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD]/g;
  while ((m = invRe.exec(text))) {
    matches.invisible.push({ start: m.index, end: m.index + 1 });
    markLine(offs, lines.length, m.index, flags, 'invisible');
  }
  const ctlRe = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  while ((m = ctlRe.exec(text))) {
    matches.control.push({ start: m.index, end: m.index + 1 });
    markLine(offs, lines.length, m.index, flags, 'control');
  }
  return {
    lines,
    flags,
    matches,
    straightQuotes: (text.match(/["']/g) || []).length,
    curlyQuotes: (text.match(/[“”‘’]/g) || []).length,
  };
}
export const DIAG_DEFS = [
  ['mojibake', 'Mojibake / encoding damage', 'violet'],
  ['invisible', 'Zero-width / invisible characters', 'violet'],
  ['specialSpace', 'Non-breaking / special spaces', 'violet'],
  ['control', 'Control / page-break characters', 'violet'],
  ['ligature', 'Typographic ligatures', 'violet'],
  ['wrap', 'Likely hard-wrapped lines', 'amber'],
  ['pageNum', 'Standalone page-number lines', 'amber'],
  ['repeatLine', 'Repeated header/footer candidates', 'amber'],
  ['extraBlank', 'Extra blank lines', 'rust'],
  ['trailingWs', 'Trailing whitespace', 'rust'],
  ['tabs', 'Tabs in the text', 'rust'],
  ['doubleSpace', 'Double spaces', 'blue'],
  ['spaceBeforePunct', 'Space before punctuation', 'blue'],
  ['apostrophe', 'Opening quote used as apostrophe', 'blue'],
  ['doubleHyphen', 'Exact -- instead of em dash', 'blue'],
  ['tripleDot', 'Three dots instead of ellipsis', 'blue'],
];
