// DOM handles shared by the UI modules and the toast.
export const $ = (sel) => document.querySelector(sel);
export const editor = $('#editor');
export const gutter = $('#gutter');
export const filenameEl = $('#filename');
const toastEl = $('#toast');
export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
}
