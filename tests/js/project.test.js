'use strict';
// Project file format on the client side.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi } = require('./adapter');

const api = loadApi();
const DEFAULTS = [{ name: 'Default A', text: 'a' }, { name: 'Default B', text: 'b' }];

test('only project settings are kept, and never anything that is not a plain value', () => {
  const picked = api.pickProjectSettings({ lmProvider: 'omlx', lmBase: 'http://x/v1', lmApiKey: 'SECRET', wrap: true, sideTab: 'ai', chunkSize: '6000', advTopK: { nested: 1 } });
  assert.deepEqual(picked, { lmProvider: 'omlx', lmBase: 'http://x/v1', chunkSize: '6000' });
  assert.deepEqual(api.pickProjectSettings(null), {});
});

test('custom prompts are the new ones and the edited built-in ones', () => {
  const prompts = [{ name: 'Default A', text: 'a' }, { name: 'Default B', text: 'b edited' }, { name: 'Mine', text: 'm' }];
  assert.deepEqual(api.customPromptsOf(prompts, DEFAULTS), [{ name: 'Default B', text: 'b edited' }, { name: 'Mine', text: 'm' }]);
});

test('merging prompts: the project wins by name, others stay', () => {
  const merged = api.mergePrompts([{ name: 'A', text: 'old' }, { name: 'Z', text: 'z' }], [{ name: 'A', text: 'new' }, { name: 'B', text: 'b' }, { name: 5, text: 'x' }, null]);
  assert.deepEqual(merged, [{ name: 'A', text: 'new' }, { name: 'Z', text: 'z' }, { name: 'B', text: 'b' }]);
});

test('buildProject collects exactly the project fields', () => {
  const project = api.buildProject({
    text: 'Hello', metadata: { title: 'T', author: 'A', junk: 'x' }, glossary: 'g', ignoredCandidates: ['colofon', 5],
    prompts: [{ name: 'Default A', text: 'a' }, { name: 'Mine', text: 'm' }], defaults: DEFAULTS, settings: { lmBase: 'u', lmApiKey: 'K' },
  });
  assert.deepEqual(project, { text: 'Hello', metadata: { title: 'T', author: 'A' }, glossary: 'g', ignoredCandidates: ['colofon'], customPrompts: [{ name: 'Mine', text: 'm' }], settings: { lmBase: 'u' } });
});

test('a project file survives an export and an import', () => {
  const project = api.buildProject({ text: 'Text é', metadata: { title: 'My Book', language: 'nl' }, glossary: '', ignoredCandidates: ['x'], prompts: [], defaults: [], settings: { lmModel: 'm' } });
  const file = api.buildProjectFile('My Book', project, new Date('2026-01-02T03:04:05Z'));
  assert.equal(file.format, 'manuscript-workbench-project');
  assert.equal(file.exportedAt, '2026-01-02T03:04:05.000Z');
  const back = api.parseProjectFile(JSON.stringify(file));
  assert.equal(back.name, 'My Book');
  assert.deepEqual(back.project, project);
});

test('importing refuses what is not a project file, with a clear reason', () => {
  assert.throws(() => api.parseProjectFile('{not json'), /not valid JSON/);
  assert.throws(() => api.parseProjectFile('[1,2]'), /not a Manuscript Workbench project/);
  assert.throws(() => api.parseProjectFile('{"format":"other","version":1,"text":""}'), /not a Manuscript Workbench project/);
  assert.throws(() => api.parseProjectFile('{"format":"manuscript-workbench-project","version":99,"text":""}'), /newer version/);
  assert.throws(() => api.parseProjectFile('{"format":"manuscript-workbench-project","version":1}'), /no text/);
});

test('an imported project without a name falls back to the title', () => {
  const f = (obj) => api.parseProjectFile({ format: 'manuscript-workbench-project', version: 1, text: 't', ...obj });
  assert.equal(f({ metadata: { title: 'From Title' } }).name, 'From Title');
  assert.equal(f({}).name, 'Imported project');
  assert.equal(f({ name: '  Named  ' }).name, 'Named');
});

test('project file names are safe', () => {
  assert.equal(api.projectFileName('My Book: Part 1!'), 'My-Book-Part-1.mwb.json');
  assert.equal(api.projectFileName('../../x'), 'x.mwb.json');
  assert.equal(api.projectFileName(''), 'project.mwb.json');
});

test('describeAge', () => {
  const now = Date.parse('2026-03-10T12:00:00Z');
  const ago = (s) => new Date(now - s * 1000).toISOString();
  assert.equal(api.describeAge(ago(10), now), 'just now');
  assert.equal(api.describeAge(ago(60), now), '1 minute ago');
  assert.equal(api.describeAge(ago(5 * 60), now), '5 minutes ago');
  assert.equal(api.describeAge(ago(3 * 3600), now), '3 hours ago');
  assert.equal(api.describeAge(ago(2 * 86400), now), '2 days ago');
  assert.equal(api.describeAge(ago(30 * 86400), now), '2026-02-08');
  assert.equal(api.describeAge('nonsense', now), '');
  assert.equal(api.describeAge(ago(-100), now), 'just now', 'a clock skew never shows a negative age');
});
