// An AI run over several sections (chunks or headings). Every section has a status of its own, so a run that was
// stopped or hit an error can be resumed, and a section that failed can be retried, without losing the others.
//
//   waiting -> running -> done
//                      -> failed   (the provider or the connection failed; `error` says why)
//                      -> stopped  (the user stopped the run while this section was being written)

const PENDING = new Set(['waiting', 'failed', 'stopped']);

export function createRun(sources) {
  return {
    items: sources.map((source, index) => ({
      index,
      source: String(source),
      status: 'waiting',
      output: '',
      error: '',
      attempts: 0,
      finishReasons: [],
    })),
  };
}

export function beginItem(item) {
  item.status = 'running';
  item.output = '';
  item.error = '';
  item.finishReasons = [];
  item.attempts++;
}

export function finishItem(item, finishReasons = []) {
  item.status = 'done';
  item.error = '';
  item.finishReasons = finishReasons.slice();
}

export function failItem(item, error) {
  item.status = 'failed';
  item.error = String(error || 'The section failed.');
  item.output = '';
}

export function stopItem(item) {
  item.status = 'stopped';
  item.output = '';
}

export function resetItem(item) {
  item.status = 'waiting';
  item.output = '';
  item.error = '';
}

export function runCounts(run) {
  const counts = { total: run.items.length, waiting: 0, running: 0, done: 0, failed: 0, stopped: 0 };
  for (const item of run.items) counts[item.status]++;
  return counts;
}

/** Indexes (in order, from `from` on) of the sections that still have to be generated. */
export function pendingIndexes(run, from = 0) {
  return run.items.filter((item) => item.index >= from && PENDING.has(item.status)).map((item) => item.index);
}

export function isComplete(run) {
  return run.items.every((item) => item.status === 'done');
}

export function finishReasonsOf(run) {
  return run.items.flatMap((item) => (item.status === 'done' ? item.finishReasons : []));
}

/**
 * The text of the run: the output of every finished section and the original text of every other one, in order.
 * `sanitize` cleans the output of one finished section (chatter in front, a wrapping code fence).
 */
export function composeRun(run, { sanitize = (text) => text } = {}) {
  return run.items
    .map((item) => (item.status === 'done' ? sanitize(item.output).trim() : item.source.trim()))
    .join('\n\n');
}

/** One line about where a run stands, for the status bar. */
export function describeRun(run, noun = 'section') {
  const c = runCounts(run);
  const plural = (n) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const parts = [`${c.done} of ${plural(c.total)} done`];
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.stopped) parts.push(`${c.stopped} stopped`);
  const left = c.waiting + c.running;
  if (left) parts.push(`${left} not started`);
  return parts.join(', ');
}
