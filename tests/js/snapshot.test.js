'use strict';
// Golden snapshot of the client-side logic. To accept an intentional change:
//   node tests/tools/generate_golden_js.js   and review the git diff.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApi } = require('./adapter');
const { computeSnapshot } = require('./snapshot');

const root = path.resolve(__dirname, '..', '..');
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'corpus.json'), 'utf8'));
const golden = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'golden', 'js_snapshot.json'), 'utf8'));
const current = computeSnapshot(loadApi(), corpus);

for (const section of Object.keys(golden)) {
  if (section === 'misc') {
    for (const key of Object.keys(golden.misc)) {
      test(`snapshot misc.${key}`, () => assert.deepStrictEqual(current.misc[key], golden.misc[key]));
    }
    continue;
  }
  for (const sample of Object.keys(golden[section])) {
    test(`snapshot ${section}.${sample}`, () => assert.deepStrictEqual(current[section][sample], golden[section][sample]));
  }
}

test('snapshot has the same sections and samples as the golden file', () => {
  assert.deepStrictEqual(Object.keys(current).sort(), Object.keys(golden).sort());
  assert.deepStrictEqual(Object.keys(current.fixes).sort(), Object.keys(corpus).sort());
});
