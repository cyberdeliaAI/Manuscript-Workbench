// Side-by-side compare view.
import { state } from './state.js';
import { cleanFilename, compareStats } from '../core/text-utils.js';
import { $, editor, toast } from './dom.js';
import { replaceRange } from './editor-ops.js';
import { snapshotBefore } from './project.js';
import { downloadBlob, importFileObject } from './files.js';

function updateCompareMeta() {
  const original = $('#compareOriginal').value,
    revised = $('#compareRevised').value;
  $('#compareOriginalMeta').textContent = original ? compareStats(original) : 'empty';
  $('#compareRevisedMeta').textContent = revised ? compareStats(revised) : 'empty';
  $('#compareSub').textContent = `Original ${compareStats(original)} · Revised ${compareStats(revised)}`;
}
function setCompareText(side, text, label = '') {
  const el = side === 'original' ? $('#compareOriginal') : $('#compareRevised');
  el.value = text || '';
  updateCompareMeta();
  if (label) $('#compareStatus').textContent = `Loaded ${label} into ${side}.`;
}
export function openCompare(original = '', revised = '', status = 'Ready.') {
  if (original !== '' || revised !== '') {
    setCompareText('original', original);
    setCompareText('revised', revised);
  }
  updateCompareMeta();
  $('#compareStatus').textContent = status;
  $('#compareModal').classList.add('open');
}
function syncCompareScroll(source, target) {
  if (state.compareScrollSyncing || !$('#compareLinked').checked || !target) return;
  state.compareScrollSyncing = true;
  const maxSource = Math.max(1, source.scrollHeight - source.clientHeight);
  const maxTarget = Math.max(0, target.scrollHeight - target.clientHeight);
  target.scrollTop = (source.scrollTop / maxSource) * maxTarget;
  requestAnimationFrame(() => {
    state.compareScrollSyncing = false;
  });
}
async function loadCompareFile(file, side) {
  if (!file) return;
  try {
    $('#compareStatus').textContent = `Loading ${file.name}...`;
    const data = await importFileObject(file);
    setCompareText(side, data.text || '', file.name);
  } catch (err) {
    $('#compareStatus').textContent = err.message;
    toast(err.message);
    alert(err.message);
  }
}
$('#compareBtn').addEventListener('click', () => openCompare('', '', 'Ready.'));
$('#closeCompareBtn').addEventListener('click', () => $('#compareModal').classList.remove('open'));
$('#compareOriginal').addEventListener('input', updateCompareMeta);
$('#compareRevised').addEventListener('input', updateCompareMeta);
$('#compareOriginal').addEventListener('scroll', () => syncCompareScroll($('#compareOriginal'), $('#compareRevised')));
$('#compareRevised').addEventListener('scroll', () => syncCompareScroll($('#compareRevised'), $('#compareOriginal')));
$('#compareOriginalInput').addEventListener('change', async (e) => {
  await loadCompareFile(e.target.files[0], 'original');
  e.target.value = '';
});
$('#compareRevisedInput').addEventListener('change', async (e) => {
  await loadCompareFile(e.target.files[0], 'revised');
  e.target.value = '';
});
$('#compareUseEditorOriginal').addEventListener('click', () => setCompareText('original', editor.value, 'editor text'));
$('#compareUseEditorRevised').addEventListener('click', () => setCompareText('revised', editor.value, 'editor text'));
$('#compareSwapBtn').addEventListener('click', () => {
  const a = $('#compareOriginal').value,
    b = $('#compareRevised').value;
  $('#compareOriginal').value = b;
  $('#compareRevised').value = a;
  updateCompareMeta();
  $('#compareStatus').textContent = 'Swapped original and revised.';
});
$('#compareExportRevisedBtn').addEventListener('click', () => {
  const text = $('#compareRevised').value;
  if (!text.trim()) {
    toast('Revised side is empty.');
    return;
  }
  const base = cleanFilename($('#metaFilename').value || state.currentFilename.replace(/\.[^.]+$/, '') || 'revised');
  downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `${base}-revised.md`);
});
$('#compareCopyRevisedBtn').addEventListener('click', () => {
  const text = $('#compareRevised').value;
  if (!text.trim()) {
    toast('Revised side is empty.');
    return;
  }
  if (editor.value && editor.value !== text && !confirm('Replace the current editor text with the revised side?'))
    return;
  snapshotBefore('Before copying the revised text into the editor');
  replaceRange(0, editor.value.length, text);
  $('#compareStatus').textContent = 'Revised copied to editor.';
  toast('Revised copied to editor');
});
