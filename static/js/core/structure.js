// Markdown structure parsing shared by outline, gutter, preview helpers and AI guardrails.
import { countWords } from './text-utils.js';

// The same rule as CHAPTER_CANDIDATE_RE in manuscript_workbench/preflight.py (tests/fixtures/parity.json keeps them equal).
export const CHAPTER_CANDIDATE_RE =
  /^\s*(?:(?:chapter|hoofdstuk|chapitre|cap[ií]tulo)\s+([0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\b.*|(?:part|deel)\s+([0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien)\b.*|prologue|epilogue|acknowledg(?:e)?ments|about the author|copyright|dedication|preface|introduction|afterword|also by|inhoud|voorwoord|nawoord|dankwoord|proloog|epiloog|colofon|inhoudsopgave|over de auteur|over de schrijver|ook van|(?:appendix|bijlage)(?:\s+(?:[0-9]+|[a-z]|[ivxlcdm]+))?)\s*$/i;
export function isChapterCandidate(line) {
  return CHAPTER_CANDIDATE_RE.test(String(line || '').trim());
}
export const MD_PREFIX_MARKERS = {
  chapter: '# ',
  part: '# ',
  subhead1: '## ',
  subhead2: '### ',
  subhead3: '#### ',
  subhead4: '##### ',
  subhead5: '###### ',
  quote: '> ',
};
export const MD_BLOCK_MARKERS = new Set([
  'verse',
  'attribution',
  'centered',
  'flush-left',
  'written-note',
  'text-conversation',
  'caption',
  'inline-image',
  'subtitle',
  'element-author',
  'hidden-heading',
]);
export const MD_STYLE_INFO = {
  chapter: ['H1', 'chapter'],
  part: ['H1', 'chapter'],
  subhead1: ['H2', 'sub'],
  subhead2: ['H3', 'sub'],
  subhead3: ['H4', 'sub'],
  subhead4: ['H5', 'sub'],
  subhead5: ['H6', 'sub'],
  quote: ['QUOTE', 'supp'],
  verse: ['VERSE', 'supp'],
  attribution: ['ATTR', 'supp'],
  centered: ['CENTER', 'supp'],
  'flush-left': ['FLUSH', 'supp'],
  'written-note': ['NOTE', 'supp'],
  'text-conversation': ['TEXT', 'supp'],
  caption: ['CAPTION', 'supp'],
  'inline-image': ['IMAGE', 'supp'],
  subtitle: ['SUBTITLE', 'supp'],
  'element-author': ['AUTHOR', 'supp'],
  'hidden-heading': ['HIDDEN', 'supp'],
  scene: ['SCENE', 'supp'],
};
export function canonicalStructureMarker(marker) {
  return (
    { note: 'written-note', text: 'text-conversation', image: 'inline-image' }[marker] ||
    marker ||
    ''
  ).toLowerCase();
}
export function isPartHeadingText(text) {
  return /^\s*(?:part|deel)\b/i.test(text || '');
}
export function markdownLineInfo(line) {
  let m = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (m) {
    const content = m[2].trim();
    const level = m[1].length;
    const map = {
      1: isPartHeadingText(content) ? 'part' : 'chapter',
      2: 'subhead1',
      3: 'subhead2',
      4: 'subhead3',
      5: 'subhead4',
      6: 'subhead5',
    };
    return { marker: map[level], content };
  }
  m = line.match(/^\s{0,3}>\s?(.*)$/);
  if (m) return { marker: 'quote', content: m[1].trim() };
  if (/^\s*(?:\*\s*){3,}$/.test(line) || /^\s*[-–—]{3,}\s*$/.test(line) || /^\s*~{3,}\s*$/.test(line))
    return { marker: 'scene', content: '' };
  return null;
}
export function stripStructureLine(line) {
  const info = markdownLineInfo(line);
  return (info ? info.content : line).trimEnd();
}
export function stripInlineMarkup(text) {
  return String(text || '')
    .replace(/\[\[(?:u|sc|sans|mono):(.+?)\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`\n]+?)`/g, '$1')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^\*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '$1$2')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^_])_(?!\s)(.+?)(?<!\s)_(?!_)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1');
}
export function stripMarkers(text) {
  return text
    .split('\n')
    .filter((l) => !l.match(/^\s*:::\s*[a-z0-9_-]*\s*$/i))
    .map((l) => {
      const info = markdownLineInfo(l);
      const line = info?.marker === 'scene' ? '* * *' : stripStructureLine(l);
      return stripInlineMarkup(line);
    })
    .join('\n');
}
export function lineOffsetsFor(text) {
  const lines = text.split('\n');
  const offs = [];
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    offs.push(acc);
    acc += lines[i].length + 1;
  }
  return { lines, offs };
}
export function wordCount(text) {
  return countWords(text);
}
export function headingOutline(text) {
  const { lines, offs } = lineOffsetsFor(text);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!h) continue;
    rows.push({
      line: i + 1,
      level: h[1].length,
      title: h[2].trim(),
      start: offs[i],
      lineEnd: offs[i] + lines[i].length,
    });
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let end = text.length;
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[j].level <= row.level) {
        end = Math.max(row.lineEnd, rows[j].start - 1);
        break;
      }
    }
    row.end = end;
    row.words = wordCount(text.slice(row.lineEnd, row.end));
  }
  return rows;
}
export function outlineKey(row) {
  return `${row.level}:${row.start}:${row.title}`;
}
export function structureSignature(text) {
  return text
    .split('\n')
    .map((line) => {
      const container = line.match(/^\s*:::\s*([a-z0-9_-]+)?\s*$/i);
      if (container) return `block:${canonicalStructureMarker(container[1] || 'end')}`;
      const md = markdownLineInfo(line);
      return md ? md.marker : '';
    })
    .filter(Boolean)
    .join('|');
}
export function markerSignature(text) {
  return structureSignature(text);
}
export function markerCount(text) {
  return structureSignature(text).split('|').filter(Boolean).length;
}
