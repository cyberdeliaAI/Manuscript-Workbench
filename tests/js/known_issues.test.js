'use strict';
// Target behaviour for the defects found in the 2026-10-27 analysis. They are `todo` tests: they run and
// are reported, but a failure does not fail the suite. Phase 1 fixes the code and removes `todo`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi } = require('./adapter');

const api = loadApi();
const fix = (id, text) => api.FIXES[id](text, { dehyphenate: true });
const TODO = 'known issue, fixed in phase 1';

test('Dutch leading elisions get a closing apostrophe, not an opening quote', { todo: TODO }, () => {
  assert.equal(fix('quotesCurly', "'s Avonds ging hij naar 't huis."), '’s Avonds ging hij naar ’t huis.');
  assert.equal(fix('quotesCurly', "Dat is 'm niet."), 'Dat is ’m niet.');
});

test('mojibake next to a no-break space is repaired in a single pass (Safe Cleanup must be idempotent)', { todo: TODO }, () => {
  const nbsp = String.fromCharCode(0xA0);
  assert.equal(fix('mojibake', `cafÃ©${nbsp}x`), `café${nbsp}x`);
  const once = api.safeCleanup(`CafÃ©${nbsp}done`);
  assert.equal(api.safeCleanup(once), once);
});

test('em dash conversion leaves scene-break lines and table separators alone', { todo: TODO }, () => {
  assert.equal(fix('dashEm', 'text\n---\ntext'), 'text\n---\ntext');
  assert.equal(fix('dashEm', '| a | b |\n|---|---|'), '| a | b |\n|---|---|');
  assert.equal(fix('dashEm', 'wait -- really'), 'wait — really');
});

test('Safe Cleanup is whitespace/encoding only: no spacing is added after punctuation', { todo: TODO }, () => {
  assert.ok(!api.SAFE_FIX_SEQUENCE.includes('spaceAfterPunct'));
  assert.equal(api.safeCleanup('etc.Dit'), 'etc.Dit');
});

test('add-space-after-punctuation does not touch identifiers like Node.JS', { todo: TODO }, () => {
  assert.equal(fix('spaceAfterPunct', 'Zie Node.JS'), 'Zie Node.JS');
  assert.equal(fix('spaceAfterPunct', 'etc.Dit'), 'etc. Dit');
});
