'use strict';
// Regression tests for the defects found in the 2026-10-27 analysis (client side).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi } = require('./adapter');

const api = loadApi();
const fix = (id, text) => api.FIXES[id](text, { dehyphenate: true });
const nbsp = String.fromCharCode(0xA0);

test('Dutch leading elisions get a closing apostrophe, not an opening quote', () => {
  assert.equal(fix('quotesCurly', "'s Avonds ging hij naar 't huis."), '’s Avonds ging hij naar ’t huis.');
  assert.equal(fix('quotesCurly', "Dat is 'm niet. 'k Weet het."), 'Dat is ’m niet. ’k Weet het.');
  assert.equal(fix('quotesCurly', "In 's-Hertogenbosch."), 'In ’s-Hertogenbosch.');
  assert.equal(fix('quotesCurly', "foto's en zo'n brug"), 'foto’s en zo’n brug');
});

test('single quotes around dialogue still open and close correctly', () => {
  assert.equal(fix('quotesCurly', "'Ik kijk naar 't water,' zei hij."), '‘Ik kijk naar ’t water,’ zei hij.');
  assert.equal(fix('quotesCurly', "He said 'hello' and left."), 'He said ‘hello’ and left.');
  assert.equal(fix('quotesCurly', "A 'tis and 'twas, '90s and 'em"), 'A ’tis and ’twas, ’90s and ’em');
});

test('em dash conversion leaves scene-break lines and table separators alone', () => {
  assert.equal(fix('dashEm', 'text\n---\ntext'), 'text\n---\ntext');
  assert.equal(fix('dashEm', '| a | b |\n|---|---|'), '| a | b |\n|---|---|');
  assert.equal(fix('dashEm', 'a | b\n--- | ---'), 'a | b\n--- | ---');
  assert.equal(fix('dashEm', '- - -'), '- - -');
});

test('em dash conversion still converts real dashes', () => {
  assert.equal(fix('dashEm', 'wait -- really'), 'wait — really');
  assert.equal(fix('dashEm', 'yes---no'), 'yes—no');
  assert.equal(fix('dashEm', 'line one --\nline two'), 'line one —\nline two');
});

test('Safe Cleanup is whitespace/encoding only: nothing is added after punctuation', () => {
  assert.ok(!api.SAFE_FIX_SEQUENCE.includes('spaceAfterPunct'));
  assert.equal(api.safeCleanup('etc.Dit'), 'etc.Dit');
  assert.ok(api.DESTRUCTIVE_FIXES.has('spaceAfterPunct')); // so it is shown as a preview first
});

test('add-space-after-punctuation does not touch identifiers or numbers', () => {
  assert.equal(fix('spaceAfterPunct', 'Zie Node.JS en 3,5 en a.b'), 'Zie Node.JS en 3,5 en a.b');
  assert.equal(fix('spaceAfterPunct', 'etc.Dit'), 'etc. Dit');
  assert.equal(fix('spaceAfterPunct', 'Stop!Nu'), 'Stop! Nu');
});

test('mojibake next to a no-break space is repaired in a single pass (Safe Cleanup is idempotent)', () => {
  assert.equal(fix('mojibake', `cafÃ©${nbsp}x`), `café${nbsp}x`);
  const once = api.safeCleanup(`CafÃ©${nbsp}done`);
  assert.equal(once, 'Café done');
  assert.equal(api.safeCleanup(once), once);
});

test('mojibake repair handles a partly damaged run without touching legitimate characters', () => {
  assert.equal(fix('mojibake', 'cafÃ© é naïve'), 'café é naïve');
  assert.equal(fix('mojibake', 'donâ€™t say â€œhiâ€\u009d'), 'don’t say “hi”');
  assert.equal(fix('mojibake', 'Ã© alone and Ã'), 'é alone and Ã');
});

test('NDJSON parser handles split chunks, blank lines and malformed lines', () => {
  const seen = [];
  const parser = api.createNdjsonParser((e) => seen.push(e));
  parser.push('{"t":"delta","te');
  parser.push('xt":"Hel"}\n\n{"t":"delta","text":"lo"}\nnot json\n{"t":"do');
  parser.push('ne"}');
  assert.equal(seen.length, 2);
  parser.end();
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), [{ t: 'delta', text: 'Hel' }, { t: 'delta', text: 'lo' }, { t: 'done' }]);
});

test('NDJSON parser: an exception in the handler is not swallowed', () => {
  const parser = api.createNdjsonParser(() => { throw new Error('handler failed'); });
  assert.throws(() => parser.push('{"t":"delta","text":"x"}\n'), /handler failed/);
});

test('local endpoint detection', () => {
  for (const host of ['localhost', 'LOCALHOST', 'foo.localhost', '127.0.0.1', '127.9.9.9', '[::1]', '::1', '10.0.0.5', '192.168.1.20',
    '172.16.0.1', '172.31.255.255', '169.254.1.1', 'mac-studio.local', 'fd12:3456::1', 'fe80::1', '0.0.0.0']) {
    assert.equal(api.isLocalEndpointHost(host), true, host);
  }
  for (const host of ['api.openai.com', 'example.com', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '11.0.0.1', '', 'localhost.evil.com']) {
    assert.equal(api.isLocalEndpointHost(host), false, host);
  }
});

test('storage layer: new keys, migration from the old vp.py.* keys, and failures never throw', () => {
  const store = new Map();
  const backend = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const storage = api.createStorage(backend);
  assert.equal(storage.get('prompts'), null);
  store.set('vp.py.prompts', '["old"]'); // written by an older version
  assert.equal(storage.get('prompts'), '["old"]');
  assert.equal(store.get('mwb.prompts'), '["old"]', 'migrated to the new key');
  assert.equal(storage.set('prompts', ['new']), true);
  assert.equal(storage.get('prompts'), 'new');
  storage.remove('prompts');
  assert.equal(storage.get('prompts'), null);
  assert.equal(store.has('vp.py.prompts'), false, 'the old key is removed as well');
});

test('storage layer survives an unavailable or full backend', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
  const storage = api.createStorage(broken);
  assert.equal(storage.get('x'), null);
  assert.equal(storage.set('x', '1'), false, 'callers can detect a full store');
  assert.doesNotThrow(() => storage.remove('x'));
  assert.equal(api.createStorage(null).get('x'), null);
});

test('prompt builders take their inputs as arguments (no DOM access)', () => {
  const prep = { text: 'T', preserveStructure: true };
  const rewrite = api.buildLmUserContent('Body', prep, 'rewrite', 'strong');
  assert.ok(rewrite.includes('Rewrite strength for this task: strong.') && rewrite.includes('<<<BEGIN TEXT>>>\nBody\n<<<END TEXT>>>'));
  assert.ok(!api.buildLmUserContent('Body', prep, 'clean', 'strong').includes('Rewrite strength'));
  const guided = api.guidedUserContent('translate', 'Body', { guidance: ' keep names ', target: ' Dutch ' });
  assert.ok(guided.includes('Target language: Dutch') && guided.includes('keep names'));
  assert.ok(api.guidedUserContent('translate', 'Body').includes('Target language: English'));
});
