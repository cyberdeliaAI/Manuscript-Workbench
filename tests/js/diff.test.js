'use strict';
// Reviewing AI output: the word diff, the paragraph alignment and composing a text from accepted/rejected hunks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApi } = require('./adapter');

const api = loadApi();
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'corpus.json'), 'utf8'));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function mutate(text, random) {
  const words = text.split(/(\s+)/);
  for (let i = 0; i < words.length; i += 2) {
    const r = random();
    if (r < 0.08) words[i] = '';
    else if (r < 0.16) words[i] = words[i] + ' extra';
    else if (r < 0.24) words[i] = words[i].toUpperCase();
  }
  return words.join('');
}

function rebuild(ops, keep) {
  return ops
    .filter((o) => o.op === 'eq' || o.op === keep)
    .map((o) => o.text)
    .join('');
}

const paragraphs = [];
for (const text of Object.values(corpus))
  for (const p of text.split(/\n\s*\n/)) if (p.trim().length > 20) paragraphs.push(p.trim());

test('word diff: a replaced word is a del plus an ins between unchanged text', () => {
  const ops = api.diffWords('The cat sat on the mat.', 'The dog sat on the mat.');
  assert.deepEqual(ops, [
    { op: 'eq', text: 'The ' },
    { op: 'del', text: 'cat' },
    { op: 'ins', text: 'dog' },
    { op: 'eq', text: ' sat on the mat.' },
  ]);
});

test('word diff: identical, empty and one-sided inputs', () => {
  assert.deepEqual(api.diffWords('same', 'same'), [{ op: 'eq', text: 'same' }]);
  assert.deepEqual(api.diffWords('', ''), []);
  assert.deepEqual(api.diffWords('', 'new'), [{ op: 'ins', text: 'new' }]);
  assert.deepEqual(api.diffWords('old', ''), [{ op: 'del', text: 'old' }]);
});

test('word diff: apostrophes stay inside a word, so only the changed word is marked', () => {
  const ops = api.diffWords("It isn't mine.", "It isn't ours.");
  assert.deepEqual(
    ops.filter((o) => o.op !== 'eq'),
    [
      { op: 'del', text: 'mine' },
      { op: 'ins', text: 'ours' },
    ],
  );
});

test('word diff: a space between two changes is folded into the change', () => {
  const ops = api.diffWords('one two three four', 'one 2 3 four');
  assert.deepEqual(ops, [
    { op: 'eq', text: 'one ' },
    { op: 'del', text: 'two three' },
    { op: 'ins', text: '2 3' },
    { op: 'eq', text: ' four' },
  ]);
});

test('word diff: eq + del rebuilds the old text and eq + ins the new one, for mutated corpus paragraphs', () => {
  const random = rng(7);
  for (const p of paragraphs.slice(0, 120)) {
    const changed = mutate(p, random);
    const ops = api.diffWords(p, changed);
    assert.equal(rebuild(ops, 'del'), p);
    assert.equal(rebuild(ops, 'ins'), changed);
    for (let i = 1; i < ops.length; i++) assert.notEqual(ops[i].op, ops[i - 1].op, 'neighbouring ops are merged');
  }
});

test('word diff: a hopeless pair falls back to replaced instead of hanging', () => {
  const random = rng(3);
  const make = () => Array.from({ length: 6000 }, () => 'w' + Math.floor(random() * 1e6)).join(' ');
  const a = make(),
    b = make();
  const started = Date.now();
  const ops = api.diffWords(a, b);
  assert.ok(Date.now() - started < 4000);
  assert.equal(rebuild(ops, 'del'), a);
  assert.equal(rebuild(ops, 'ins'), b);
});

test('splitBlocks loses nothing, whatever the whitespace', () => {
  const samples = [
    '',
    '   \n\n  ',
    'one',
    'one\n\ntwo',
    '\n\n  one\n\n\n\ntwo  \n\nthree\n',
    'a\nb\n \nc\n\t\nd',
    'Chapter\r\n\r\ntext\r\n',
    'trailing  ',
  ];
  for (const text of samples) {
    const { lead, blocks } = api.splitBlocks(text);
    assert.equal(lead + blocks.map((b) => b.text + b.sep).join(''), text, JSON.stringify(text));
  }
  assert.deepEqual(
    api.splitBlocks('a\nb\n\nc').blocks.map((b) => b.text),
    ['a\nb', 'c'],
  );
});

test('documents: identical texts have only unchanged hunks', () => {
  const diff = api.diffDocuments('One.\n\nTwo.\n', 'One.\n\nTwo.\n');
  assert.deepEqual(
    diff.hunks.map((h) => h.kind),
    ['same', 'same'],
  );
  assert.deepEqual(api.reviewableIds(diff), []);
  assert.equal(api.composeFromHunks(diff, new Set()), 'One.\n\nTwo.\n');
});

test('documents: a rewritten paragraph is one changed hunk with its word diff', () => {
  const diff = api.diffDocuments('A.\n\nThe cat sat on the mat.\n\nC.', 'A.\n\nThe dog sat on the mat.\n\nC.');
  assert.deepEqual(
    diff.hunks.map((h) => h.kind),
    ['same', 'changed', 'same'],
  );
  assert.deepEqual(diff.stats, { same: 2, changed: 1, added: 0, removed: 0 });
  assert.ok(diff.hunks[1].words.some((o) => o.op === 'del' && o.text === 'cat'));
});

test('documents: added and removed paragraphs are found next to unchanged ones', () => {
  const before = 'Alpha one.\n\nBeta two.\n\nGamma three.';
  const after = 'Alpha one.\n\nBeta two.\n\nInserted paragraph here.\n\nGamma three.';
  assert.deepEqual(
    api.diffDocuments(before, after).hunks.map((h) => h.kind),
    ['same', 'same', 'added', 'same'],
  );
  assert.deepEqual(
    api.diffDocuments(after, before).hunks.map((h) => h.kind),
    ['same', 'same', 'removed', 'same'],
  );
});

test('documents: when every paragraph is reworded they are still paired one to one', () => {
  const before = [
    'The harbour was quiet that morning.',
    'Marta counted the boats twice.',
    'Nobody answered the door.',
  ].join('\n\n');
  const after = ['Quiet lay the harbour at dawn.', 'Twice did Marta tally the vessels.', 'The door stayed shut.'].join(
    '\n\n',
  );
  const diff = api.diffDocuments(before, after);
  assert.deepEqual(
    diff.hunks.map((h) => h.kind),
    ['changed', 'changed', 'changed'],
  );
});

test('documents: a paragraph that was split in two is one changed hunk and one added hunk', () => {
  const before =
    'Intro.\n\nMarta walked to the harbour and counted the boats, twice, because nobody else would.\n\nEnd.';
  const after =
    'Intro.\n\nMarta walked to the harbour and counted the boats, twice.\n\nBecause nobody else would.\n\nEnd.';
  const kinds = api.diffDocuments(before, after).hunks.map((h) => h.kind);
  assert.equal(kinds[0], 'same');
  assert.equal(kinds[kinds.length - 1], 'same');
  assert.deepEqual(kinds.slice(1, -1).sort(), ['added', 'changed']);
});

test('compose: accepting everything gives the AI output back, rejecting everything the original', () => {
  const random = rng(11);
  for (let n = 0; n < 40; n++) {
    const before = paragraphs.slice(n, n + 6).join(n % 2 ? '\n\n' : '\n\n\n') + (n % 3 ? '\n' : '');
    const after = mutate(before, random).replace(/\n+$/, n % 2 ? '' : '\n');
    const diff = api.diffDocuments(before, after);
    assert.equal(api.composeFromHunks(diff, new Set()), after);
    // A difference in trailing whitespace alone leaves nothing to review, so there is nothing to reject either.
    if (api.reviewableIds(diff).length)
      assert.equal(api.composeFromHunks(diff, new Set(api.reviewableIds(diff))), before);
  }
});

test('compose: a rejected hunk keeps the old paragraph, the others take the new text', () => {
  const before = 'One old.\n\nTwo old.\n\nThree old.\n';
  const after = 'One new.\n\nTwo new.\n\nThree new.\n';
  const diff = api.diffDocuments(before, after);
  assert.equal(api.composeFromHunks(diff, new Set([1])), 'One new.\n\nTwo old.\n\nThree new.\n');
  assert.equal(api.composeFromHunks(diff, new Set([0, 2])), 'One old.\n\nTwo new.\n\nThree old.\n');
});

test('compose: rejecting an added paragraph drops it, rejecting a removed one brings it back', () => {
  const before = 'Alpha one.\n\nBeta two.\n\nGamma three.';
  const after = 'Alpha one.\n\nNew paragraph about nothing.\n\nBeta two.';
  const diff = api.diffDocuments(before, after);
  const added = diff.hunks.find((h) => h.kind === 'added');
  const removed = diff.hunks.find((h) => h.kind === 'removed');
  assert.equal(api.composeFromHunks(diff, new Set([added.id])), 'Alpha one.\n\nBeta two.');
  assert.equal(
    api.composeFromHunks(diff, new Set([removed.id])),
    'Alpha one.\n\nNew paragraph about nothing.\n\nBeta two.\n\nGamma three.',
  );
});

test('compose: random accept/reject choices keep every accepted new paragraph and every rejected old one', () => {
  const random = rng(5);
  for (let n = 0; n < 30; n++) {
    const blocks = paragraphs.slice(n * 3, n * 3 + 8);
    const before = blocks.join('\n\n');
    const after = blocks.map((b) => (random() < 0.5 ? mutate(b, random) : b)).join('\n\n');
    const diff = api.diffDocuments(before, after);
    const rejected = new Set(api.reviewableIds(diff).filter(() => random() < 0.5));
    const result = api.composeFromHunks(diff, rejected);
    for (const h of diff.hunks) {
      if (h.kind === 'same') continue;
      if (rejected.has(h.id)) {
        if (h.before) assert.ok(result.includes(h.before.text));
      } else if (h.after) assert.ok(result.includes(h.after.text));
    }
  }
});

test('documents: 3000 reworded paragraphs are aligned quickly', () => {
  const before = Array.from(
    { length: 3000 },
    (_, i) => `Paragraph ${i} says that the harbour was quiet and nobody came to the door.`,
  ).join('\n\n');
  const after = Array.from(
    { length: 3000 },
    (_, i) => `Paragraph ${i} tells how quiet the harbour was, and nobody answered at the door.`,
  ).join('\n\n');
  const started = Date.now();
  const diff = api.diffDocuments(before, after);
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
  assert.equal(diff.stats.changed, 3000);
});
