'use strict';
// Language profiles: detection, quote and dash styles, apostrophe repair.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi } = require('./adapter');

const api = loadApi();
const fix = (id, text, opts = {}) => api.FIXES[id](text, { dehyphenate: true, ...opts });

const DUTCH = 'Het was een mooie dag en de zon scheen over het water. Ik ging naar het huis van mijn moeder voor een kopje koffie, maar ze was niet thuis. Hij wist het niet en ze zou het ook niet weten. Wij liepen door de stad naar het station, want de trein zou om twaalf uur vertrekken.';
const ENGLISH = 'It was a beautiful day and the sun shone over the water. She went to the house of her mother for a cup of coffee, but she was not at home. He did not know it and they would not know it either. We walked through the city to the station, because the train would leave at noon and there was nothing else that they could do.';

test('detectLanguage tells English from Dutch and admits when it is unsure', () => {
  assert.equal(api.detectLanguage(DUTCH.repeat(2)).id, 'nl');
  assert.equal(api.detectLanguage(ENGLISH.repeat(2)).id, 'en');
  assert.equal(api.detectLanguage('Too short.').id, '');
  assert.equal(api.detectLanguage('').id, '');
  assert.equal(api.detectLanguage(DUTCH.repeat(2) + ENGLISH.repeat(2)).id, '', 'a 50/50 mix is not decided');
});

test('detectLanguage samples long texts instead of reading all of them', () => {
  const long = (DUTCH + ' ').repeat(2000);
  const t0 = Date.now();
  assert.equal(api.detectLanguage(long).id, 'nl');
  assert.ok(Date.now() - t0 < 200);
});

test('resolveTypography: language, quote style and dash style', () => {
  const nl = api.resolveTypography({ language: 'Nederlands' });
  assert.equal(nl.profile.id, 'nl');
  assert.equal(nl.dash, 'spaced-en');
  assert.equal(api.resolveTypography({ language: 'nl', dashStyle: 'em' }).dash, 'em');
  assert.equal(api.resolveTypography({}).profile.id, 'en', 'no language means English');
  assert.equal(api.resolveTypography({ language: 'fr' }).spaceBeforePunct, 'keep');
  assert.equal(api.resolveTypography({ quoteStyle: 'low-high' }).quotes.open, '„');
  assert.equal(api.resolveTypography({ quoteStyle: 'nonsense' }).quotes.open, '“');
});

test('quotes to curly follows the chosen quote style', () => {
  assert.equal(fix('quotesCurly', 'He said "hi" and \'bye\'.'), 'He said “hi” and ‘bye’.');
  assert.equal(fix('quotesCurly', 'Hij zei "hoi" en \'dag\'.', { quoteStyle: 'low-high' }), 'Hij zei „hoi” en ‚dag’.');
  assert.equal(fix('quotesCurly', 'Hij zei "hoi".', { language: 'nl' }), 'Hij zei “hoi”.');
});

test('"other" languages get no English or Dutch elision guesses', () => {
  assert.equal(fix('quotesCurly', "the letter 't' and 'em", { language: 'other' }), 'the letter ‘t’ and ‘em');
  assert.equal(fix('quotesCurly', "the '90s", { language: 'other' }), 'the ’90s', 'decades stay');
  assert.equal(fix('quotesCurly', "'s Avonds en 't huis", { language: 'nl' }), '’s Avonds en ’t huis');
});

test('quotes to straight also undoes low-high quotes', () => {
  assert.equal(fix('quotesStraight', '„hoi” ‚dag’ “x” ‘y’'), '"hoi" \'dag\' "x" \'y\'');
});

test('dash style: English em dash keeps spacing, Dutch gets a spaced en dash', () => {
  assert.equal(fix('dashEm', 'wait -- really'), 'wait — really');
  assert.equal(fix('dashEm', 'prachtig -- echt', { language: 'nl' }), 'prachtig – echt');
  assert.equal(fix('dashEm', 'woord--woord en woord---woord', { language: 'nl' }), 'woord – woord en woord – woord');
  assert.equal(fix('dashEm', '-- Hallo, zei hij.', { language: 'nl' }), '– Hallo, zei hij.', 'a dialogue dash at the line start');
  assert.equal(fix('dashEm', 'tot nu toe --', { language: 'nl' }), 'tot nu toe –');
  assert.equal(fix('dashEm', 'wait -- really', { language: 'nl', dashStyle: 'em' }), 'wait — really');
  assert.equal(fix('dashEm', 'a -- b', { language: 'en', dashStyle: 'spaced-en' }), 'a – b');
});

test('dash conversion still leaves scene breaks and table separators alone in every style', () => {
  for (const opts of [{}, { language: 'nl' }, { dashStyle: 'spaced-en' }]) {
    assert.equal(fix('dashEm', 'x\n---\ny\n|---|---|', opts), 'x\n---\ny\n|---|---|');
  }
});

test('space before punctuation is only removed for languages where that is correct', () => {
  assert.equal(fix('spaceBeforePunct', 'Hello , world !'), 'Hello, world!');
  assert.equal(fix('spaceBeforePunct', 'Hallo , wereld !', { language: 'nl' }), 'Hallo, wereld!');
  assert.equal(fix('spaceBeforePunct', 'Bonjour : quoi ?', { language: 'fr' }), 'Bonjour : quoi ?');
  assert.equal(api.safeCleanup('Bonjour : quoi ?  ok', { language: 'fr' }), 'Bonjour : quoi ? ok', 'Safe Cleanup respects it too');
});

test('Repair apostrophes fixes what word processors get wrong', () => {
  assert.equal(fix('apostrophes', '‘s Avonds ging hij naar ‘t huis, ‘k weet het.', { language: 'nl' }), '’s Avonds ging hij naar ’t huis, ’k weet het.');
  assert.equal(fix('apostrophes', 'in the ‘90s and rock ‘n roll', { language: 'en' }), 'in the ’90s and rock ’n roll');
  assert.equal(fix('apostrophes', '‘Hello’ she said and ‘Dag’', { language: 'nl' }), '‘Hello’ she said and ‘Dag’', 'real quotes stay');
  assert.equal(fix('apostrophes', '‘t huis in the ‘90s', { language: 'other' }), '‘t huis in the ’90s');
  assert.ok(api.DESTRUCTIVE_FIXES.has('apostrophes'), 'shown as a preview first');
});

test('diagnostics: wrong apostrophes are found, and space-before-punctuation depends on the language', () => {
  const text = 'Hij ging ‘s avonds naar ‘t huis , echt !';
  const nl = api.diagnose(text, { language: 'nl' });
  assert.equal(nl.matches.apostrophe.length, 2);
  assert.deepEqual(nl.matches.apostrophe.map((m) => text.slice(m.start, m.end)), ['‘', '‘']);
  assert.equal(nl.matches.spaceBeforePunct.length, 2);
  const fr = api.diagnose(text, { language: 'fr' });
  assert.equal(fr.matches.spaceBeforePunct.length, 0);
  assert.equal(fr.matches.apostrophe.length, 0, 'no elision guesses for "other" languages');
  assert.ok(api.DIAG_DEFS.some(([key]) => key === 'apostrophe'));
});
