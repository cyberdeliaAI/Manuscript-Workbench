'use strict';
// Chapter candidates: finding them, ignoring them and marking them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi } = require('./adapter');

const api = loadApi();
const TEXT = ['# Real Chapter', '', 'Some text.', '', 'Chapter 3', '', 'Prologue', '', '::: verse', 'Chapter in a block', ':::', '', 'Hoofdstuk Vier', '## Marked sub'].join('\n');

test('analyzeStructure splits marked structure from candidates', () => {
  const r = api.analyzeStructure(TEXT);
  assert.deepEqual([r.chapters, r.subheads, r.special], [1, 1, 1]); // the one line of content inside the verse block
  assert.deepEqual(r.candidates.map((c) => [c.line, c.text]), [[5, 'Chapter 3'], [7, 'Prologue'], [13, 'Hoofdstuk Vier']]);
  assert.equal(r.ignored.length, 0);
});

test('lines inside a ::: block and already marked lines are never candidates', () => {
  const r = api.analyzeStructure('# Chapter 1\n\n::: note\nChapter 2\n:::\n\n## Chapter 3');
  assert.deepEqual(r.candidates, []);
});

test('ignored candidates are matched by key (case and spacing do not matter)', () => {
  const r = api.analyzeStructure(TEXT, ['  PROLOGUE ', 'hoofdstuk   vier']);
  assert.deepEqual(r.candidates.map((c) => c.text), ['Chapter 3']);
  assert.deepEqual(r.ignored.map((c) => c.text), ['Prologue', 'Hoofdstuk Vier']);
});

test('markCandidateLines marks only the given lines', () => {
  const out = api.markCandidateLines(TEXT, [5, 13]);
  const lines = out.split('\n');
  assert.equal(lines[4], '# Chapter 3');
  assert.equal(lines[12], '# Hoofdstuk Vier');
  assert.equal(lines[6], 'Prologue', 'line 7 was not asked for');
  assert.equal(api.markCandidateLines('  Chapter 2  \nx', [1], 'h2'), '## Chapter 2\nx');
  assert.equal(api.markCandidateLines('a\n\nb', [2]), 'a\n\nb', 'empty lines are left alone');
});

test('after marking, the candidates become structure', () => {
  const next = api.markCandidateLines(TEXT, api.analyzeStructure(TEXT).candidates.map((c) => c.line));
  const r = api.analyzeStructure(next);
  assert.equal(r.candidates.length, 0);
  assert.equal(r.chapters, 4);
});
