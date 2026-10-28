// Reviewing AI output: a word-level diff, a paragraph-level alignment and the "hunks" the reviewer accepts or rejects.
//
//   diffWords(a, b)            -> [{ op: 'eq' | 'del' | 'ins', text }]   (eq + del rebuilds a, eq + ins rebuilds b)
//   diffDocuments(before, after) -> { hunks, ... }                        (one hunk per differing paragraph)
//   composeFromHunks(diff, rejected) -> the text with the rejected hunks left as they were

const TOKEN_RE = /[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*|\s+|[^\s\p{L}\p{N}\p{M}]/gu;
const WORD_RE = /[\p{L}\p{N}\p{M}]+/gu;
const MAX_EDIT_DISTANCE = 2000; // beyond this a paragraph is shown as replaced instead of word by word
const MIN_WORD_DIFF_SIMILARITY = 0.25; // less alike than this: show the old paragraph struck out and the new one added
const PAIR_BIAS = 0.15; // an aligned pair scores `similarity - PAIR_BIAS`, so any pair beats leaving two paragraphs unmatched
const GAP_COST = 0.35;
const FULL_MATRIX_CELLS = 160000;

export function tokenize(text) {
  return String(text || '').match(TOKEN_RE) || [];
}

// ---- shortest edit script (Myers) --------------------------------------------------------------

/**
 * Edit script between two arrays of comparable items, or null when more than maxD edits are needed.
 * The result is a list of { op: 'eq' | 'del' | 'ins', a: index in a, b: index in b } steps.
 */
function shortestEdit(a, b, maxD) {
  const n = a.length,
    m = b.length;
  if (!n && !m) return [];
  const limit = Math.min(maxD, n + m);
  const off = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  const steps = [];
  let x = n,
    y = m;
  for (let d = found; d > 0; d--) {
    const t = trace[d]; // the furthest-reaching points after round d - 1, indexed by k + d + 1
    const k = x - y;
    const prevK = k === -d || (k !== d && t[k - 1 + d + 1] < t[k + 1 + d + 1]) ? k + 1 : k - 1;
    const prevX = t[prevK + d + 1];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      steps.push({ op: 'eq', a: x, b: y });
    }
    if (x === prevX) steps.push({ op: 'ins', a: x, b: prevY });
    else steps.push({ op: 'del', a: prevX, b: y });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    steps.push({ op: 'eq', a: x, b: y });
  }
  return steps.reverse();
}

// ---- word diff ---------------------------------------------------------------------------------

function pushOp(ops, op, text) {
  if (!text) return;
  const last = ops[ops.length - 1];
  if (last && last.op === op) last.text += text;
  else ops.push({ op, text });
}

/** Within a run of changes put every deletion before the insertions, so "old new" reads as one replacement. */
function orderChanges(ops) {
  const out = [];
  let del = '',
    ins = '';
  const flush = () => {
    pushOp(out, 'del', del);
    pushOp(out, 'ins', ins);
    del = '';
    ins = '';
  };
  for (const o of ops) {
    if (o.op === 'del') del += o.text;
    else if (o.op === 'ins') ins += o.text;
    else {
      flush();
      pushOp(out, 'eq', o.text);
    }
  }
  flush();
  return out;
}

/** A lone space between two changes is not worth a separate "unchanged" mark: fold it into the change. */
function absorbSpaces(ops) {
  const isChange = (o) => o && o.op !== 'eq';
  const out = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.op === 'eq' && /^\s+$/.test(o.text) && isChange(out[out.length - 1]) && isChange(ops[i + 1])) {
      let del = '',
        ins = '';
      while (isChange(out[out.length - 1])) {
        const prev = out.pop();
        if (prev.op === 'del') del = prev.text + del;
        else ins = prev.text + ins;
      }
      del += o.text;
      ins += o.text;
      let j = i + 1;
      while (isChange(ops[j])) {
        if (ops[j].op === 'del') del += ops[j].text;
        else ins += ops[j].text;
        j++;
      }
      pushOp(out, 'del', del);
      pushOp(out, 'ins', ins);
      i = j - 1;
    } else out.push({ ...o });
  }
  return out;
}

export function diffWords(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a === b) return a ? [{ op: 'eq', text: a }] : [];
  const ta = tokenize(a),
    tb = tokenize(b);
  let start = 0;
  while (start < ta.length && start < tb.length && ta[start] === tb[start]) start++;
  let endA = ta.length,
    endB = tb.length;
  while (endA > start && endB > start && ta[endA - 1] === tb[endB - 1]) {
    endA--;
    endB--;
  }
  const ops = [];
  pushOp(ops, 'eq', ta.slice(0, start).join(''));
  const midA = ta.slice(start, endA),
    midB = tb.slice(start, endB);
  const steps = midA.length && midB.length ? shortestEdit(midA, midB, MAX_EDIT_DISTANCE) : null;
  if (steps) {
    for (const s of steps) pushOp(ops, s.op, s.op === 'ins' ? midB[s.b] : midA[s.a]);
  } else {
    pushOp(ops, 'del', midA.join(''));
    pushOp(ops, 'ins', midB.join(''));
  }
  pushOp(ops, 'eq', ta.slice(endA).join(''));
  return absorbSpaces(orderChanges(ops));
}

// ---- paragraphs --------------------------------------------------------------------------------

/**
 * Splits a text into paragraphs without losing anything: `lead` is the whitespace before the first one, every block
 * remembers the whitespace that follows it (`sep`; for the last block that is the trailing whitespace of the text).
 */
export function splitBlocks(text) {
  text = String(text || '');
  const lead = text.match(/^\s*/)[0];
  const rest = text.slice(lead.length);
  if (!rest) return { lead, blocks: [] };
  const parts = rest.split(/(\s*\n[ \t]*\n\s*)/);
  const blocks = [];
  for (let i = 0; i < parts.length; i += 2) {
    const raw = parts[i];
    const body = raw.replace(/\s+$/, '');
    const trail = raw.slice(body.length);
    blocks.push({ text: body, sep: i + 1 < parts.length ? parts[i + 1] : trail });
  }
  return { lead, blocks };
}

function wordSet(text) {
  const set = new Set();
  for (const w of String(text).toLowerCase().match(WORD_RE) || []) set.add(w);
  return set;
}

function similarity(sa, sb) {
  if (!sa.size && !sb.size) return 1;
  if (!sa.size || !sb.size) return 0;
  let shared = 0;
  const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  for (const w of small) if (large.has(w)) shared++;
  return (2 * shared) / (sa.size + sb.size);
}

/**
 * Pairs up the paragraphs of two lists that have nothing exactly in common. Returns [[i | null, j | null], ...] in
 * document order. Needleman-Wunsch on word overlap, restricted to a band around the diagonal for long lists.
 */
function alignBySimilarity(a, b) {
  const p = a.length,
    q = b.length;
  if (!p) return b.map((_, j) => [null, j]);
  if (!q) return a.map((_, i) => [i, null]);
  const sa = a.map(wordSet),
    sb = b.map(wordSet);
  const band = p * q <= FULL_MATRIX_CELLS ? Math.max(p, q) : Math.max(40, Math.abs(p - q) + 20);
  const width = 2 * band + 1;
  const centre = (i) => Math.round((i * q) / p);
  const score = new Float64Array((p + 1) * width).fill(-Infinity);
  const dir = new Uint8Array((p + 1) * width); // 1 = pair, 2 = a unmatched, 3 = b unmatched
  const at = (i, j) => {
    const col = j - (centre(i) - band);
    return col < 0 || col >= width ? -1 : i * width + col;
  };
  score[at(0, 0)] = 0;
  for (let i = 0; i <= p; i++) {
    const lo = Math.max(0, centre(i) - band),
      hi = Math.min(q, centre(i) + band);
    for (let j = lo; j <= hi; j++) {
      if (!i && !j) continue;
      const here = at(i, j);
      let best = -Infinity,
        move = 0;
      if (i && j) {
        const from = at(i - 1, j - 1);
        if (from >= 0 && score[from] > -Infinity) {
          const s = score[from] + similarity(sa[i - 1], sb[j - 1]) - PAIR_BIAS;
          if (s > best) {
            best = s;
            move = 1;
          }
        }
      }
      if (i) {
        const from = at(i - 1, j);
        if (from >= 0 && score[from] > -Infinity && score[from] - GAP_COST > best) {
          best = score[from] - GAP_COST;
          move = 2;
        }
      }
      if (j) {
        const from = at(i, j - 1);
        if (from >= 0 && score[from] > -Infinity && score[from] - GAP_COST > best) {
          best = score[from] - GAP_COST;
          move = 3;
        }
      }
      score[here] = best;
      dir[here] = move;
    }
  }
  const pairs = [];
  let i = p,
    j = q;
  while (i > 0 || j > 0) {
    const move = dir[at(i, j)];
    if (move === 1) pairs.push([--i, --j]);
    else if (move === 2) pairs.push([--i, null]);
    else if (move === 3) pairs.push([null, --j]);
    else break; // cannot happen while the band holds the end point; keeps a broken matrix from looping
  }
  while (i > 0) pairs.push([--i, null]);
  while (j > 0) pairs.push([null, --j]);
  return pairs.reverse();
}

/** Paragraph pairs in order: exact matches first (Myers over the paragraph texts), then similarity inside the gaps. */
function alignBlocks(a, b) {
  const ta = a.map((blk) => blk.text),
    tb = b.map((blk) => blk.text);
  let start = 0;
  while (start < ta.length && start < tb.length && ta[start] === tb[start]) start++;
  let endA = ta.length,
    endB = tb.length;
  while (endA > start && endB > start && ta[endA - 1] === tb[endB - 1]) {
    endA--;
    endB--;
  }
  const pairs = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  const midA = ta.slice(start, endA),
    midB = tb.slice(start, endB);
  const steps = midA.length && midB.length ? shortestEdit(midA, midB, MAX_EDIT_DISTANCE) : null;
  const gap = { a: [], b: [] };
  const flushGap = () => {
    if (gap.a.length || gap.b.length) {
      const sub = alignBySimilarity(
        gap.a.map((i) => ta[i]),
        gap.b.map((j) => tb[j]),
      );
      for (const [i, j] of sub) pairs.push([i === null ? null : gap.a[i], j === null ? null : gap.b[j]]);
    }
    gap.a = [];
    gap.b = [];
  };
  if (steps) {
    for (const s of steps) {
      if (s.op === 'eq') {
        flushGap();
        pairs.push([start + s.a, start + s.b]);
      } else if (s.op === 'del') gap.a.push(start + s.a);
      else gap.b.push(start + s.b);
    }
    flushGap();
  } else {
    gap.a = midA.map((_, i) => start + i);
    gap.b = midB.map((_, j) => start + j);
    flushGap();
  }
  for (let k = 0; k < ta.length - endA; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

/**
 * Compares the text before and after an AI run paragraph by paragraph. Every hunk is one paragraph:
 *   same     unchanged (never offered for review)
 *   changed  a paragraph that was rewritten; `words` is its word diff
 *   added    a paragraph that only exists in the new text
 *   removed  a paragraph that only exists in the old text
 */
export function diffDocuments(before, after) {
  before = String(before || '');
  after = String(after || '');
  const a = splitBlocks(before),
    b = splitBlocks(after);
  const hunks = [];
  const stats = { same: 0, changed: 0, added: 0, removed: 0 };
  for (const [i, j] of alignBlocks(a.blocks, b.blocks)) {
    const old = i === null ? null : a.blocks[i];
    const now = j === null ? null : b.blocks[j];
    let kind,
      words = null,
      alike = 1;
    if (!old) kind = 'added';
    else if (!now) kind = 'removed';
    else if (old.text === now.text) kind = 'same';
    else {
      kind = 'changed';
      alike = similarity(wordSet(old.text), wordSet(now.text));
      words =
        alike >= MIN_WORD_DIFF_SIMILARITY
          ? diffWords(old.text, now.text)
          : [
              { op: 'del', text: old.text },
              { op: 'ins', text: now.text },
            ];
    }
    stats[kind]++;
    hunks.push({ id: hunks.length, kind, before: old, after: now, words, similarity: alike });
  }
  return {
    hunks,
    stats,
    beforeText: before,
    afterText: after,
    lead: { before: a.lead, after: b.lead },
    trail: {
      before: a.blocks.length ? a.blocks[a.blocks.length - 1].sep : '',
      after: b.blocks.length ? b.blocks[b.blocks.length - 1].sep : '',
    },
    lastOf: { before: a.blocks[a.blocks.length - 1] || null, after: b.blocks[b.blocks.length - 1] || null },
  };
}

/** The ids of the hunks a reviewer can decide on. */
export function reviewableIds(diff) {
  return diff.hunks.filter((h) => h.kind !== 'same').map((h) => h.id);
}

/**
 * The text that results when the hunks in `rejected` (a Set of ids) keep the old paragraph and all others take the new
 * one. Accepting everything gives the AI output back exactly, rejecting everything gives the original text back.
 */
export function composeFromHunks(diff, rejected = new Set()) {
  const ids = reviewableIds(diff);
  const rejectedCount = ids.filter((id) => rejected.has(id)).length;
  if (rejectedCount === 0) return diff.afterText;
  if (rejectedCount === ids.length) return diff.beforeText;
  const pieces = [];
  for (const h of diff.hunks) {
    let side = 'after';
    if (h.kind === 'changed' || h.kind === 'added' || h.kind === 'removed') {
      const accepted = !rejected.has(h.id);
      side = accepted ? 'after' : 'before';
    }
    const blk = h[side];
    if (blk) pieces.push({ text: blk.text, sep: blk.sep, side, last: blk === diff.lastOf[side] });
  }
  if (!pieces.length) return '';
  let out = diff.lead[pieces[0].side];
  pieces.forEach((p, i) => {
    out += p.text;
    if (i < pieces.length - 1) out += p.last || !p.sep ? '\n\n' : p.sep;
    else out += diff.trail[p.side];
  });
  return out;
}
