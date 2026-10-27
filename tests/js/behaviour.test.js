'use strict';
// Readable assertions about client-side behaviour that must keep working.
// Invisible characters are built with fromCharCode so they stay visible in this source.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi } = require('./adapter');

const api = loadApi();
const fix = (id, text) => api.FIXES[id](text, { dehyphenate: true });
const ch = (code) => String.fromCharCode(code);
const NBSP = ch(0xA0), SHY = ch(0xAD), ZWSP = ch(0x200B), BOM = ch(0xFEFF), THIN = ch(0x2009), NUL = ch(0), FF = ch(0x0C);
const LIG_FI = ch(0xFB01), LIG_FFI = ch(0xFB03);

test('mojibake is repaired but valid text is untouched', () => {
  assert.equal(fix('mojibake', 'cafÃ© and naÃ¯ve'), 'café and naïve');
  assert.equal(fix('mojibake', 'Café is fine'), 'Café is fine');
});

test('invisible, special-space, control and ligature fixes', () => {
  assert.equal(fix('invisible', `a${ZWSP}b${SHY}c${BOM}`), 'abc');
  assert.equal(fix('specialSpaces', `a${NBSP}b${THIN}c`), 'a b c');
  assert.equal(fix('controlChars', `a${FF}b${NUL}c\td`), 'abc\td');
  assert.equal(fix('ligatures', `${LIG_FI}nal o${LIG_FFI}ce`), 'final office');
});

test('join wrapped lines keeps headings, lists and sentence ends apart', () => {
  const text = 'The sentence continues here and goes on for a while\nwith the next line of the text.\n\nCHAPTER ONE\nStart.';
  assert.equal(fix('join', text), 'The sentence continues here and goes on for a while with the next line of the text.\n\nCHAPTER ONE\nStart.');
});

test('join leaves short lines alone (poetry protection)', () => {
  const poem = 'Roses are red\nViolets are blue';
  assert.equal(fix('join', poem), poem);
});

test('dehyphenation joins a word split at the line end', () => {
  assert.equal(fix('join', 'A long line that ends in a split inter-\nnational word follows here.'),
    'A long line that ends in a split international word follows here.');
});

test('page numbers and blank runs', () => {
  assert.equal(fix('pageNumbers', 'text\n\n12\n\n- 13 -\n\nPage 14 of 200\nmore'), 'text\n\n\n\nmore');
  assert.equal(fix('blankRuns', 'a\n\n\n\nb'), 'a\n\nb');
});

test('quotes, dashes and ellipsis', () => {
  assert.equal(fix('quotesCurly', 'He said "hi" and \'bye\'.'), 'He said “hi” and ‘bye’.');
  assert.equal(fix('quotesStraight', '“hi” ‘x’'), '"hi" \'x\'');
  assert.equal(fix('dashEm', 'wait -- really'), 'wait — really');
  assert.equal(fix('ellipsis', 'wait... and . . . more'), 'wait… and … more');
});

test('safe cleanup is idempotent', () => {
  const messy = `CafÃ© done .${NBSP} Next\ttab  \n\n\nEnd `;
  const once = api.safeCleanup(messy);
  assert.equal(api.safeCleanup(once), once);
});

test('markdown line info', () => {
  const plainObj = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plainObj(api.markdownLineInfo('# Chapter One')), { marker: 'chapter', content: 'Chapter One' });
  assert.deepEqual(plainObj(api.markdownLineInfo('# Part One')), { marker: 'part', content: 'Part One' });
  assert.deepEqual(plainObj(api.markdownLineInfo('### x')), { marker: 'subhead2', content: 'x' });
  assert.deepEqual(plainObj(api.markdownLineInfo('> q')), { marker: 'quote', content: 'q' });
  assert.equal(api.markdownLineInfo('***').marker, 'scene');
  assert.equal(api.markdownLineInfo('plain'), null);
});

test('strip markers produces readable plain text', () => {
  const out = api.stripMarkers('# Title\n\n> *quoted* **text**\n\n***\n\n::: verse\n[[sc:Line]]\n:::');
  assert.equal(out, 'Title\n\nquoted text\n\n* * *\n\nLine');
});

test('chunking never splits a paragraph and respects headings', () => {
  const text = '# One\n\n' + 'word '.repeat(40).trim() + '\n\n# Two\n\nshort';
  const chunks = [...api.makeChunks(text, 100)];
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => !c.includes('# One') || c.startsWith('# One')));
  assert.equal(chunks.join('\n\n').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
});

test('integrity guardrails flag large length changes and missing names', () => {
  const before = 'Marta met Pieter in Utrecht on 12 March. '.repeat(5);
  const result = api.analyzeIntegrity(before, 'Short.');
  assert.ok(result.issues.some((s) => s.startsWith('length changed')));
  assert.ok(result.issues.some((s) => s.startsWith('names missing')));
});

test('final AI text is cleaned of think blocks, code fences and chatter', () => {
  assert.equal(api.sanitizeLmFinalText('<think>x</think>Answer'), 'Answer');
  assert.equal(api.sanitizeLmFinalText('```markdown\n# T\ntext\n```'), '# T\ntext');
  assert.equal(api.sanitizeLmFinalText("Here is the rewritten text:\n\nBody"), 'Body');
});

test('structural cleanups are previewed before they are applied', () => {
  for (const id of ['join', 'dashEm', 'blankRuns', 'pageNumbers', 'repeatLines', 'quotesCurly']) {
    assert.ok(api.DESTRUCTIVE_FIXES.has(id), id);
  }
});
