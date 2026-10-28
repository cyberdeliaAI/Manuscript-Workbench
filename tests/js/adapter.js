'use strict';
// Loads the pure core modules (static/js/core/*) and exposes them as one flat object, so tests can keep using
// plain function names. Needs Node >= 22.12 (require() of ES modules).
const path = require('node:path');

const CORE_DIR = path.resolve(__dirname, '..', '..', 'static', 'js', 'core');
const MODULES = [
  'storage', 'text-utils', 'structure', 'inline-markup', 'mojibake', 'line-heuristics', 'language', 'candidates', 'cleaning',
  'diagnostics', 'analysis', 'chunking', 'integrity', 'prompts', 'ai-stream', 'project', 'diff', 'glossary',
];

function loadApi() {
  const api = {};
  for (const name of MODULES) Object.assign(api, require(path.join(CORE_DIR, `${name}.js`)));
  return api;
}

module.exports = { loadApi };
