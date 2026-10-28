#!/usr/bin/env node
'use strict';
// Regenerates tests/fixtures/golden/js_snapshot.json from the implementation under test.
// Run:  node tests/tools/generate_golden_js.js   then review `git diff tests/fixtures/golden/js_snapshot.json`.
const fs = require('node:fs');
const path = require('node:path');
const { loadApi } = require('../js/adapter');
const { computeSnapshot, stableStringify } = require('../js/snapshot');

const root = path.resolve(__dirname, '..', '..');
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'corpus.json'), 'utf8'));
const out = path.join(root, 'tests', 'fixtures', 'golden', 'js_snapshot.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, stableStringify(computeSnapshot(loadApi(), corpus)));
console.log('wrote', out);
