'use strict';
// The project glossary: parsing, matching, the prompt block and the checks on AI output.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApi } = require('./adapter');

const api = loadApi();

test('parseGlossary reads plain terms and translations and skips comments and blank lines', () => {
  const { entries, problems } = api.parseGlossary(
    '# names\nMarta\n\n  De Zeven Zussen => The Seven Sisters  \r\nBrandt\n',
  );
  assert.deepEqual(
    entries.map((e) => [e.term, e.translation, e.line]),
    [
      ['Marta', null, 2],
      ['De Zeven Zussen', 'The Seven Sisters', 4],
      ['Brandt', null, 5],
    ],
  );
  assert.deepEqual(problems, []);
});

test('parseGlossary reports unusable lines and keeps the first of a duplicate', () => {
  const { entries, problems } = api.parseGlossary(' => nothing\nHaven =>\nMarta\nmarta\nOK');
  assert.deepEqual(
    entries.map((e) => e.term),
    ['Marta', 'OK'],
  );
  assert.deepEqual(
    problems.map((p) => p.line),
    [1, 2, 4],
  );
  assert.match(problems[2].message, /already on line 3/);
});

test('countTerm matches whole words, case-sensitively, also next to an apostrophe or punctuation', () => {
  assert.equal(api.countTerm("Marta's coat. Marta! marta, Martaschool, 'Marta'", 'Marta'), 3);
  assert.equal(api.countTerm('Will you? I will.', 'Will'), 1);
  assert.equal(api.countTerm('C++ and C++.', 'C++'), 2);
  assert.equal(api.countTerm('Mr. Brandt met Mr. Brandt', 'Mr. Brandt'), 2);
  assert.equal(api.countTerm('Éloïse en eloïse', 'Éloïse'), 1);
  assert.equal(api.countTerm('anything', ''), 0);
});

test('relevantEntries keeps only the entries that occur in the text', () => {
  const { entries } = api.parseGlossary('Marta\nBrandt\nHaven => Harbour');
  assert.deepEqual(
    api.relevantEntries(entries, 'Marta walked.').map((e) => e.term),
    ['Marta'],
  );
  assert.deepEqual(
    api.relevantEntries(entries, 'The Harbour was quiet.').map((e) => e.term),
    ['Haven'],
  );
  assert.deepEqual(api.relevantEntries(entries, 'Nobody.'), []);
});

test('the prompt block keeps terms for a rewrite and enforces translations when translating', () => {
  const { entries } = api.parseGlossary('Marta\nHaven => Harbour');
  const rewrite = api.glossaryPromptBlock(entries, 'rewrite');
  assert.match(rewrite, /"Marta", "Haven", "Harbour"/);
  assert.doesNotMatch(rewrite, /=>/);
  const translate = api.glossaryPromptBlock(entries, 'translate');
  assert.match(translate, /"Marta"/);
  assert.match(translate, /- "Haven" => "Harbour"/);
  assert.doesNotMatch(translate.split('\n')[1], /Haven/);
  assert.equal(api.glossaryPromptBlock([], 'rewrite'), '');
});

test('withGlossary adds only what the text needs', () => {
  const { entries } = api.parseGlossary('Marta\nBrandt');
  const prompt = api.withGlossary('SYSTEM', entries, 'rewrite', 'Marta walked.');
  assert.ok(prompt.startsWith('SYSTEM\n\n## Glossary'));
  assert.match(prompt, /"Marta"/);
  assert.doesNotMatch(prompt, /Brandt/);
  assert.equal(api.withGlossary('SYSTEM', entries, 'rewrite', 'Nobody here.'), 'SYSTEM');
  assert.equal(api.withGlossary('SYSTEM', [], 'rewrite', 'Marta'), 'SYSTEM');
});

test('glossaryIssues flags a kept term that disappeared or became rarer', () => {
  const { entries } = api.parseGlossary('Marta\nBrandt');
  assert.deepEqual(
    api
      .glossaryIssues('Marta met Brandt. Marta left.', 'Marta met Brandt. She left.', entries, 'rewrite')
      .map((i) => i.term),
    ['Marta'],
  );
  assert.deepEqual(api.glossaryIssues('Marta left.', 'Marta left, quietly.', entries, 'rewrite'), []);
  assert.deepEqual(api.glossaryIssues('Nobody.', 'Somebody.', entries, 'rewrite'), []);
});

test('glossaryIssues checks translations only for a translation task', () => {
  const { entries } = api.parseGlossary('De Zeven Zussen => The Seven Sisters');
  const dutch = 'De Zeven Zussen kwamen. De Zeven Zussen gingen.';
  assert.deepEqual(
    api.glossaryIssues(dutch, 'The Seven Sisters came. The Seven Sisters left.', entries, 'translate'),
    [],
  );
  const notTranslated = api.glossaryIssues(
    dutch,
    'De Zeven Zussen came. The Seven Sisters left.',
    entries,
    'translate',
  );
  assert.match(notTranslated[0].message, /was not translated/);
  const wrongWord = api.glossaryIssues(dutch, 'The Sisters came. The Sisters left.', entries, 'translate');
  assert.match(wrongWord[0].message, /appears 0x for/);
  // a rewrite of text that already holds the translation must keep it
  assert.equal(
    api.glossaryIssues('The Seven Sisters came.', 'They came.', entries, 'rewrite')[0].term,
    'The Seven Sisters',
  );
});

test('suggestNames finds recurring names but not words that only start sentences', () => {
  const text =
    'Suddenly the door opened. Then Marta said hello to Brandt, and later Marta left. Suddenly it rained. Brandt waved at Marta.';
  assert.deepEqual(api.suggestNames(text), ['Marta', 'Brandt']);
  assert.deepEqual(api.suggestNames(text, { known: ['marta'] }), ['Brandt']);
  assert.deepEqual(api.suggestNames(text, { minCount: 4 }), []);
});
