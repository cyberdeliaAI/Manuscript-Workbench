'use strict';
// The editor (JavaScript) and preflight (Python) implement the same rules twice. These shared cases keep them
// identical. The same file is read by tests/python/test_parity.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApi } = require('./adapter');

const api = loadApi();
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'parity.json'), 'utf8'));

for (const [line, marker, content] of cases.line_markers) {
  test(`line marker: ${JSON.stringify(line)}`, () => {
    const info = api.markdownLineInfo(line);
    assert.equal(info ? info.marker : '', marker);
    if (marker) assert.equal(info.content, content);
  });
}

for (const [line, expected] of cases.chapter_candidates) {
  test(`chapter candidate: ${JSON.stringify(line)}`, () => {
    assert.equal(api.isChapterCandidate(line), expected);
  });
}

for (const c of cases.page_numbers) {
  test(`page number: ${JSON.stringify(c.lines)} @${c.index}`, () => {
    assert.equal(api.isLikelyPageNumberLine(c.lines[c.index], c.index, c.lines), c.expected);
  });
}

for (const [value, expected] of cases.languages) {
  test(`language: ${JSON.stringify(value)}`, () => {
    assert.equal(api.normalizeLanguage(value), expected);
  });
}

for (const [text, language, expected] of cases.apostrophes) {
  test(`wrong apostrophes: ${JSON.stringify(text)} (${language})`, () => {
    assert.equal(api.countWrongApostrophes(text, language), expected);
  });
}
