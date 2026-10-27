'use strict';
// Loads the pure functions of the current single-file app (the embedded <script> in app.py) into a
// sandbox with a stubbed DOM. After the restructure (phase 2) only this file changes: it will import the
// real modules from static/js instead, and every test keeps using the same function names.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_PATH = path.resolve(__dirname, '..', '..', 'app.py');

const EXPORTS = [
  'FIXES', 'SAFE_FIX_SEQUENCE', 'DESTRUCTIVE_FIXES', 'safeCleanup',
  'diagnose', 'markdownLineInfo', 'stripStructureLine', 'stripInlineMarkup', 'stripMarkers',
  'canonicalStructureMarker', 'headingOutline', 'structureSignature', 'markerCount',
  'analyzeIntegrity', 'sanitizeLmFinalText', 'createNdjsonParser', 'isLocalEndpointHost', 'isDashProtectedLine',
  'makeChunks', 'makeHeadingSections', 'splitParagraphBlocks', 'makeParagraphChunks',
  'isSceneBreak', 'shouldJoinLines', 'isLikelyPageNumberLine', 'repeatedLineCandidates',
  'escapeHtml', 'cleanFilename', 'listItemInfo', 'unwrapInlineText', 'inlineWrapper',
];

function makeStub() {
  const stub = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      if (prop === 'length') return 0;
      return stub;
    },
    set() { return true; },
    apply() { return stub; },
    construct() { return stub; },
  });
  return stub;
}

function embeddedScript() {
  const src = fs.readFileSync(APP_PATH, 'utf8');
  const start = src.indexOf('<script>\n', src.indexOf("HTML = r'''")) + '<script>\n'.length;
  const end = src.indexOf('</script>', start);
  let js = src.slice(start, end);
  const bootstrap = /\nloadPrompts\(\); loadSettings\(\)[^\n]*\n?$/;
  if (!bootstrap.test(js)) throw new Error('bootstrap line not found in embedded script');
  return js.replace(bootstrap, '\n'); // the last line starts the app and needs a real DOM
}

function loadApi() {
  const stub = makeStub();
  const sandbox = {
    console, TextDecoder, TextEncoder, URL, AbortController, setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { querySelector: () => stub, querySelectorAll: () => [], addEventListener() {}, createElement: () => stub, body: stub, activeElement: null },
    navigator: {}, fetch: async () => { throw new Error('no network in tests'); },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_NODE: 9, DOCUMENT_FRAGMENT_NODE: 11 },
    Event: class {}, getComputedStyle: () => stub, confirm: () => true, alert() {}, prompt: () => null,
    addEventListener() {}, innerWidth: 1200,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(embeddedScript(), sandbox, { filename: 'app.py:embedded.js' });
  return vm.runInContext('({' + EXPORTS.join(',') + '})', sandbox);
}

module.exports = { loadApi, embeddedScript };
