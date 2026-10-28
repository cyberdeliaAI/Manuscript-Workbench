// Splitting text into chunks and heading sections for AI runs.
export function makeChunks(text, maxChars) {
  const headingSections = makeHeadingSectionsNoFallback(text);
  const chunks = [];
  let largeParagraphs = 0;
  headingSections.forEach((section) => {
    if (maxChars > 0 && section.length > maxChars * 1.25) {
      const parts = makeParagraphChunks(section, maxChars);
      largeParagraphs += parts.largeParagraphCount || 0;
      chunks.push(...parts);
    } else {
      chunks.push(section);
    }
  });
  chunks.largeParagraphCount = largeParagraphs;
  return chunks.filter((chunk) => String(chunk || '').trim());
}
export function splitParagraphBlocks(text) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let buf = [];
  const push = () => {
    if (buf.length) {
      blocks.push(buf.join('\n').trimEnd());
      buf = [];
    }
  };
  for (const line of lines) {
    if (line.trim() === '') {
      push();
    } else {
      buf.push(line);
    }
  }
  push();
  return blocks.filter((block) => block.trim());
}
export function makeParagraphChunks(text, maxChars) {
  const blocks = splitParagraphBlocks(text);
  if (!blocks.length) return String(text || '').trim() ? [String(text || '')] : [];
  const chunks = [];
  let buf = [],
    len = 0,
    huge = 0;
  const push = () => {
    if (buf.length) {
      chunks.push(buf.join('\n\n'));
      buf = [];
      len = 0;
    }
  };
  blocks.forEach((block) => {
    const addLen = block.length + (buf.length ? 2 : 0);
    if (maxChars > 0 && len > 0 && len + addLen > maxChars) push();
    if (maxChars > 0 && block.length > maxChars * 1.25) huge++;
    buf.push(block);
    len += addLen;
  });
  push();
  chunks.largeParagraphCount = huge;
  return chunks;
}
export function makeHeadingSectionsNoFallback(text) {
  const lines = String(text || '').split('\n');
  const rawSections = [];
  let buf = [];
  const push = () => {
    if (buf.length) {
      const section = buf.join('\n');
      if (section.trim()) rawSections.push(section);
      buf = [];
    }
  };
  for (const line of lines) {
    const isHeading = /^\s{0,3}#{1,6}\s+\S/.test(line);
    if (isHeading && buf.length) push();
    buf.push(line);
  }
  push();
  return rawSections.length ? rawSections : String(text || '').trim() ? [String(text || '')] : [];
}
export function makeHeadingSections(text, maxChars = 0) {
  const base = makeHeadingSectionsNoFallback(text);
  const sections = [];
  let oversized = 0,
    largeParagraphs = 0;
  base.forEach((section) => {
    if (maxChars > 0 && section.length > maxChars * 1.25) {
      const parts = makeParagraphChunks(section, maxChars);
      largeParagraphs += parts.largeParagraphCount || 0;
      if (parts.length > 1) {
        oversized++;
        sections.push(...parts);
        return;
      }
    }
    sections.push(section);
  });
  sections.oversizedCount = oversized;
  sections.largeParagraphCount = largeParagraphs;
  sections.originalCount = base.length;
  return sections;
}
export function headingSplitNote(sections) {
  const notes = [];
  if (sections.oversizedCount)
    notes.push(
      `${sections.oversizedCount} large heading section(s) were split further on whole paragraphs using Chunk size.`,
    );
  if (sections.largeParagraphCount)
    notes.push(
      `${sections.largeParagraphCount} paragraph(s) were larger than Chunk size and were sent whole to avoid cutting a paragraph in half.`,
    );
  return notes.join(' ');
}

/**
 * A chunk size (in characters) that a model with this context window (in tokens) can rewrite in one go: the answer
 * is about as long as the text, and part of the window goes to the prompt. 0 when the window is not known.
 */
export function suggestChunkSize(contextTokens) {
  const tokens = Number(contextTokens);
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  const chars = Math.floor((((tokens - 1500) / 2) * 3.5) / 100) * 100;
  return Math.min(12000, Math.max(1200, chars));
}
