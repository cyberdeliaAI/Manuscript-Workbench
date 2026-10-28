// The line-number gutter. It only builds the lines that are on screen (plus some margin), so it costs the same
// for a 100-line text and a 500,000-word manuscript.
import { GUTTER_STYLES } from '../core/analysis.js';
import { editor, gutter } from './dom.js';

const LINE_HEIGHT = 20; // must match the editor's line-height
const OVERSCAN = 40; // lines built above and below the visible part

const inner = document.createElement('div');
inner.className = 'gutter-inner';
const windowEl = document.createElement('div');
windowEl.className = 'gutter-window';
inner.appendChild(windowEl);
gutter.replaceChildren(inner);

let lineCount = 1;
let codes = new Uint8Array(0);
let built = { first: -1, last: -1 };

/** Called with every analysis result: the number of lines and one code per line (see GUTTER_STYLES). */
export function setGutterData(count, lineCodes) {
  lineCount = Math.max(1, count);
  codes = lineCodes;
  inner.style.height = `${lineCount * LINE_HEIGHT}px`;
  built = { first: -1, last: -1 };
  renderGutterWindow();
}

export function renderGutterWindow() {
  if (editor.classList.contains('wrap')) return; // the gutter is hidden while word wrap is on
  const topLine = Math.floor(editor.scrollTop / LINE_HEIGHT);
  const visible = Math.ceil(editor.clientHeight / LINE_HEIGHT);
  const first = Math.max(0, topLine - OVERSCAN);
  const last = Math.min(lineCount, topLine + visible + OVERSCAN);
  if (built.first >= 0 && Math.abs(first - built.first) < OVERSCAN / 2 && Math.abs(last - built.last) < OVERSCAN / 2)
    return;
  built = { first, last };
  const frag = document.createDocumentFragment();
  for (let i = first; i < last; i++) {
    const style = GUTTER_STYLES[codes[i]];
    const el = document.createElement('div');
    el.className = style ? `gline ${style.className}` : 'gline';
    if (style?.note) el.title = style.note;
    el.textContent = String(i + 1);
    frag.appendChild(el);
  }
  windowEl.style.transform = `translateY(${first * LINE_HEIGHT}px)`;
  windowEl.replaceChildren(frag);
}

function syncGutterScroll() {
  gutter.scrollTop = editor.scrollTop;
  renderGutterWindow();
}
editor.addEventListener('scroll', syncGutterScroll);
window.addEventListener('resize', renderGutterWindow);
