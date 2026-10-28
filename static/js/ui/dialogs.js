// A small in-app dialog that asks for one line of text (a project name). Resolves with the text, or null if cancelled.
import { $ } from './dom.js';

let cancelPending = null;

export function askName({ title, label, value = '', okLabel = 'OK', hint = '' }) {
  const modal = $('#nameModal');
  const input = $('#nameModalInput');
  const ok = $('#nameModalOk');
  const cancel = $('#nameModalCancel');
  $('#nameModalTitle').textContent = title;
  $('#nameModalLabel').textContent = label;
  $('#nameModalHint').textContent = hint;
  ok.textContent = okLabel;
  input.value = value;
  if (cancelPending) cancelPending();
  modal.classList.add('open');
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
  return new Promise((resolve) => {
    const finish = (result) => {
      modal.classList.remove('open');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      modal.removeEventListener('mousedown', onBackdrop);
      cancelPending = null;
      resolve(result);
    };
    const onOk = () => {
      const text = input.value.trim();
      if (text) finish(text);
      else input.focus();
    };
    const onCancel = () => finish(null);
    const onKey = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onOk();
      } else if (event.key === 'Escape') finish(null);
    };
    const onBackdrop = (event) => {
      if (event.target === modal) finish(null);
    };
    cancelPending = onCancel;
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
    modal.addEventListener('mousedown', onBackdrop);
  });
}
