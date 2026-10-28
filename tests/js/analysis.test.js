'use strict';
// analyzeText: the one-pass analysis behind the side panels and the gutter, and the helpers it relies on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApi } = require('./adapter');

const api = loadApi();
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'corpus.json'), 'utf8'));

test('countWords equals the regex count, including Unicode whitespace', () => {
  const ch = (...codes) => String.fromCharCode(...codes);
  const samples = [
    '',
    '   ',
    'one',
    ' one  two\tthree\nfour ',
    `a${ch(0xa0)}b${ch(0x2009)}c${ch(0x3000)}d${ch(0xfeff)}e`,
    `x${ch(0x200b)}y`,
    `${ch(0x2028)}a${ch(0x2029)}b`,
    ...Object.values(corpus),
  ];
  for (const s of samples)
    assert.equal(api.countWords(s), (s.match(/\S+/g) || []).length, JSON.stringify(s.slice(0, 30)));
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pool = ['a', 'b', ' ', '\n', '\t', ch(0xa0), ch(0x2003), ch(0x200b), 'é', '—', '1'];
  for (let n = 0; n < 200; n++) {
    let s = '';
    for (let i = 0, len = Math.floor(rnd() * 60); i < len; i++) s += pool[Math.floor(rnd() * pool.length)];
    assert.equal(api.countWords(s), (s.match(/\S+/g) || []).length, JSON.stringify(s));
  }
});

test('analyzeText agrees with the separate analyses for every corpus sample', () => {
  for (const [name, text] of Object.entries(corpus)) {
    const r = api.analyzeText(text, { language: 'en' });
    const diag = api.diagnose(text, { language: 'en' });
    assert.equal(r.stats.chars, text.length, name);
    assert.equal(r.stats.lines, text.split('\n').length, name);
    for (const [key, list] of Object.entries(diag.matches)) {
      assert.deepEqual(
        Array.from(r.diag.positions[key]),
        list.flatMap((m) => [m.start, m.end]),
        `${name}.${key}`,
      );
    }
    assert.deepEqual(JSON.parse(JSON.stringify(r.outline)), JSON.parse(JSON.stringify(api.headingOutline(text))), name);
    assert.deepEqual(
      JSON.parse(JSON.stringify(r.structure)),
      JSON.parse(JSON.stringify(api.analyzeStructure(text, []))),
      name,
    );
    assert.equal(r.gutter.length, r.stats.lines, name);
  }
});

test('stats count chapters and subheads per line', () => {
  const r = api.analyzeText('# One\n\n## Two\n### Three\n#nospace\n    # indented four\n# Four');
  assert.deepEqual([r.stats.chapters, r.stats.subheads], [2, 2]);
  assert.equal(api.analyzeText('#\nTitle').stats.chapters, 0, 'a bare # line is not a chapter');
});

test('gutter codes follow the diagnostics of each line', () => {
  const text = 'clean line\ntrailing space \n# Heading\ndouble  space\ncafÃ© mojibake';
  const g = Array.from(api.analyzeText(text).gutter);
  assert.deepEqual(g, [0, api.GUTTER_SPACING, api.GUTTER_STRUCTURE, api.GUTTER_TYPOGRAPHY, api.GUTTER_ENCODING]);
  assert.ok(Object.keys(api.GUTTER_STYLES).length === 5);
});

test('the result can be moved between threads and carries the language suggestion', () => {
  const r = api.analyzeText('Het was een mooie dag en de zon scheen over het water. '.repeat(10));
  assert.equal(r.language, 'nl');
  const buffers = api.transferables(r);
  assert.ok(buffers.length >= 2 && buffers.every((b) => b instanceof ArrayBuffer));
});

test('ignored candidates reach the structure analysis', () => {
  const r = api.analyzeText('Prologue\n\ntext\n\nChapter 2', { ignoredCandidates: ['prologue'] });
  assert.deepEqual(
    r.structure.candidates.map((c) => c.text),
    ['Chapter 2'],
  );
  assert.deepEqual(
    r.structure.ignored.map((c) => c.text),
    ['Prologue'],
  );
});

test('a 500,000 word manuscript is analysed in a few seconds at most', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const vocab =
    'the of and to in that was he she it you with for on as had his her they at be not from by this but we have were said'.split(
      ' ',
    );
  const parts = [];
  let words = 0;
  let chapter = 0;
  while (words < 500000) {
    if (words >= chapter * 5000) parts.push(`# Chapter ${++chapter}`, '');
    const n = 20 + Math.floor(rnd() * 100);
    const p =
      Array.from({ length: n }, () => vocab[Math.floor(rnd() * vocab.length)]).join(' ') +
      (rnd() < 0.1 ? '  extra -- dash.' : '.');
    words += n;
    parts.push(p, '');
  }
  const t0 = Date.now();
  const r = api.analyzeText(parts.join('\n'), { language: 'en' });
  const ms = Date.now() - t0;
  assert.ok(r.stats.words >= 500000 && r.stats.chapters === 100 && r.outline.length === 100);
  assert.ok(ms < 5000, `took ${ms} ms`);
});
