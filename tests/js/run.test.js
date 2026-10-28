'use strict';
// Runs over several sections: statuses, resuming, retrying and what the result text looks like.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi } = require('./adapter');

const api = loadApi();

function run(...sources) {
  return api.createRun(sources.length ? sources : ['A source.', 'B source.', 'C source.', 'D source.']);
}

test('a new run has every section waiting, in order', () => {
  const r = run();
  assert.deepEqual(
    r.items.map((i) => [i.index, i.status]),
    [
      [0, 'waiting'],
      [1, 'waiting'],
      [2, 'waiting'],
      [3, 'waiting'],
    ],
  );
  assert.deepEqual(api.pendingIndexes(r), [0, 1, 2, 3]);
  assert.deepEqual(api.runCounts(r), { total: 4, waiting: 4, running: 0, done: 0, failed: 0, stopped: 0 });
});

test('section lifecycle: begin, finish, fail, stop and reset', () => {
  const r = run();
  api.beginItem(r.items[0]);
  r.items[0].output = 'partial';
  assert.equal(r.items[0].status, 'running');
  assert.equal(r.items[0].attempts, 1);
  api.finishItem(r.items[0], ['stop']);
  assert.deepEqual([r.items[0].status, r.items[0].finishReasons], ['done', ['stop']]);
  api.beginItem(r.items[1]);
  r.items[1].output = 'half a section';
  api.failItem(r.items[1], 'HTTP 500');
  assert.deepEqual([r.items[1].status, r.items[1].error, r.items[1].output], ['failed', 'HTTP 500', '']);
  api.beginItem(r.items[2]);
  api.stopItem(r.items[2]);
  assert.deepEqual([r.items[2].status, r.items[2].output], ['stopped', '']);
  api.resetItem(r.items[1]);
  assert.deepEqual([r.items[1].status, r.items[1].error], ['waiting', '']);
  api.beginItem(r.items[1]);
  assert.equal(r.items[1].attempts, 2);
});

test('pendingIndexes lists what a resume or a "run from here" has to do', () => {
  const r = run();
  api.finishItem(r.items[0]);
  api.failItem(r.items[1], 'x');
  api.finishItem(r.items[2]);
  assert.deepEqual(api.pendingIndexes(r), [1, 3]);
  assert.deepEqual(api.pendingIndexes(r, 2), [3]);
  assert.deepEqual(api.pendingIndexes(r, 4), []);
  assert.equal(api.isComplete(r), false);
  api.finishItem(r.items[1]);
  api.finishItem(r.items[3]);
  assert.equal(api.isComplete(r), true);
});

test('composeRun uses the output of finished sections and the original text of all others', () => {
  const r = run();
  r.items[0].output = '  A rewritten.\n\n';
  api.finishItem(r.items[0]);
  api.failItem(r.items[1], 'x');
  r.items[2].output = 'C rewritten.';
  api.finishItem(r.items[2]);
  assert.equal(api.composeRun(r), 'A rewritten.\n\nB source.\n\nC rewritten.\n\nD source.');
});

test('composeRun can clean every finished section on its own', () => {
  const r = run('One.', 'Two.');
  r.items[0].output = 'Here is the rewritten text:\n\nOne, changed.';
  api.finishItem(r.items[0]);
  r.items[1].output = '```\nTwo, changed.\n```';
  api.finishItem(r.items[1]);
  const clean = (text) => text.replace(/^Here is the rewritten text:\s*/, '').replace(/^```\n([\s\S]*)\n```$/, '$1');
  assert.equal(api.composeRun(r, { sanitize: clean }), 'One, changed.\n\nTwo, changed.');
});

test('finish reasons are collected from finished sections only', () => {
  const r = run();
  api.finishItem(r.items[0], ['stop']);
  api.finishItem(r.items[1], ['length']);
  api.failItem(r.items[2], 'x');
  r.items[3].finishReasons = ['content_filter'];
  assert.deepEqual(api.finishReasonsOf(r), ['stop', 'length']);
});

test('describeRun says what is done, failed and not started', () => {
  const r = run();
  assert.equal(api.describeRun(r), '0 of 4 sections done, 4 not started');
  api.finishItem(r.items[0]);
  api.finishItem(r.items[1]);
  api.failItem(r.items[2], 'x');
  assert.equal(api.describeRun(r), '2 of 4 sections done, 1 failed, 1 not started');
  assert.equal(api.describeRun(run('Only.'), 'chunk'), '0 of 1 chunk done, 1 not started');
});
