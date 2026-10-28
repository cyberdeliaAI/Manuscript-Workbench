'use strict';
// What the interface says about the models a provider reports.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi } = require('./adapter');

const api = loadApi();

test('suggestChunkSize: the answer is as long as the text, so about half of what is left of the window', () => {
  assert.equal(api.suggestChunkSize(4096), 4500);
  assert.equal(api.suggestChunkSize(8192), 11700);
});

test('suggestChunkSize stays between 1200 and 12000 characters and is 0 when the window is unknown', () => {
  assert.equal(api.suggestChunkSize(2048), 1200);
  assert.equal(api.suggestChunkSize(131072), 12000);
  for (const unknown of [0, -1, NaN, undefined, null, 'x']) assert.equal(api.suggestChunkSize(unknown), 0);
});

test('modelLabel shows what the provider said and nothing it did not', () => {
  assert.equal(api.modelLabel('plain'), 'plain');
  assert.equal(
    api.modelLabel('qwen', { loaded: true, contextLength: 8192, maxContextLength: 32768, quantization: 'Q4_K_M' }),
    'qwen · loaded · 8k context · Q4_K_M',
  );
  assert.equal(
    api.modelLabel('gemma', { loaded: false, maxContextLength: 131072 }),
    'gemma · not loaded · 128k context',
  );
  assert.equal(api.modelLabel('small', { contextLength: 512 }), 'small · 512 context');
});

test('modelHint suggests a chunk size for a model with a known context window', () => {
  const hint = api.modelHint({ loaded: true, contextLength: 8192 }, api.suggestChunkSize);
  assert.equal(hint.chunkSize, 11700);
  assert.match(hint.text, /8,192 tokens/);
  assert.match(hint.text, /11,700 characters/);
});

test('modelHint warns about a model that is not loaded and stays silent without information', () => {
  const idle = api.modelHint({ loaded: false, maxContextLength: 32768 }, api.suggestChunkSize);
  assert.equal(idle.chunkSize, 0);
  assert.match(idle.text, /Not loaded yet/);
  assert.match(idle.text, /32,768 tokens/);
  assert.deepEqual(api.modelHint(undefined, api.suggestChunkSize), { text: '', chunkSize: 0 });
  assert.deepEqual(api.modelHint({ type: 'llm' }, api.suggestChunkSize), { text: '', chunkSize: 0 });
});
