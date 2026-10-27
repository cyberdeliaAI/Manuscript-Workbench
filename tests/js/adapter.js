'use strict';
// Loads the pure functions of the current frontend script (static/js/legacy-app.js) into a
// sandbox with a stubbed DOM. After the restructure (phase 2) only this file changes: it will import the
// real modules from static/js instead, and every test keeps using the same function names.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'static', 'js', 'legacy-app.js');

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
  const js = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const bootstrap = /\nloadPrompts\(\); loadSettings\(\)[^\n]*\n?$/;
  if (!bootstrap.test(js)) throw new Error('bootstrap line not found in the script');
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
  vm.runInContext(embeddedScript(), sandbox, { filename: 'static/js/legacy-app.js' });
  return vm.runInContext('({' + EXPORTS.join(',') + '})', sandbox);
}

module.exports = { loadApi, embeddedScript };
