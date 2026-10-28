// Import, URL import, folder merge and export.
import { state } from './state.js';
import { stripMarkers } from '../core/structure.js';
import {
  arrayBufferToBase64,
  cleanFilename,
  escapeHtml,
  fileDisplaySize,
  isHtmlFile,
  isMergeableFile,
} from '../core/text-utils.js';
import { api } from './api.js';
import { $, editor, filenameEl, toast } from './dom.js';
import { getMetadata } from './settings.js';
import { snapshotBefore } from './project.js';
import { updateStats } from './stats.js';
import { pushUndoSnapshot, undoStack, updateUndoButton } from './undo.js';

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}
function applyImportedText(data, displayName, sizeLabel = '') {
  if (
    editor.value &&
    !confirm(`Replace the current editor text with "${displayName || data.filename || 'the imported file'}"?`)
  )
    return false;
  snapshotBefore(`Before loading ${displayName || data.filename || 'a file'}`);
  editor.value = data.text || '';
  state.currentFilename = data.filename || displayName || 'manuscript.txt';
  filenameEl.textContent = sizeLabel ? `${displayName} (${sizeLabel})` : displayName;
  $('#metaFilename').value = cleanFilename((data.filename || displayName || 'manuscript').replace(/\.[^.]+$/, ''));
  undoStack.length = 0;
  updateUndoButton();
  updateStats();
  toast((data.notes || []).join(' · ') || 'File loaded');
  return true;
}
export async function importFileObject(file) {
  const b64 = arrayBufferToBase64(await file.arrayBuffer());
  const res = await api('/api/import', {
    filename: file.webkitRelativePath || file.name,
    data_b64: b64,
    html_mode: isHtmlFile(file) ? 'main' : 'simple',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Import failed: ${file.name}`);
  return {
    file,
    name: file.name,
    path: file.webkitRelativePath || file.name,
    size: file.size,
    text: data.text || '',
    notes: data.notes || [],
    filename: data.filename || file.name,
  };
}
async function importHtmlFileOptions(file) {
  const b64 = arrayBufferToBase64(await file.arrayBuffer());
  const res = await api('/api/import_html_options', { filename: file.webkitRelativePath || file.name, data_b64: b64 });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTML import failed: ${file.name}`);
  openHtmlImportChoice(data, { displayName: file.name, size: file.size });
}
function openHtmlImportChoice(data, source) {
  state.htmlImportState = { data, source: source || {} };
  const simple = data.simple || {},
    main = data.main || {};
  $('#htmlImportTitle').textContent = source?.url ? 'Choose URL Import' : 'Choose HTML Import';
  $('#htmlImportSub').textContent = source?.url
    ? `${source.url}`
    : `${source?.displayName || data.filename || 'HTML'} - compare extraction methods before loading`;
  $('#htmlSimpleBox').textContent = simple.text || '(No text extracted.)';
  $('#htmlMainBox').textContent =
    main.text || (main.error ? `Trafilatura unavailable:\n${main.error}` : '(No main text extracted.)');
  $('#htmlSimpleMeta').textContent = `${(simple.chars || 0).toLocaleString()} chars`;
  $('#htmlMainMeta').textContent =
    main.error && !main.text ? 'unavailable' : `${(main.chars || 0).toLocaleString()} chars`;
  $('#htmlUseSimpleBtn').disabled = !simple.text;
  $('#htmlUseMainBtn').disabled = !main.text;
  $('#htmlImportStatus').textContent = (data.notes || []).join(' · ') || 'Choose an import method.';
  $('#htmlImportModal').classList.add('open');
}
function useHtmlImport(kind) {
  if (!state.htmlImportState) return;
  const { data, source } = state.htmlImportState;
  const chosen = (kind === 'main' ? data.main : data.simple) || {};
  if (!chosen.text) {
    toast('No text available for that method.');
    return;
  }
  if (
    !applyImportedText(
      {
        text: chosen.text,
        filename: data.filename,
        notes: [kind === 'main' ? 'Imported with Trafilatura main text' : 'Imported with simple extraction'],
      },
      source.displayName || data.filename || 'HTML import',
      source.size ? fileDisplaySize(source.size) : '',
    )
  )
    return;
  $('#htmlImportModal').classList.remove('open');
  state.htmlImportState = null;
}
$('#htmlUseSimpleBtn').addEventListener('click', () => useHtmlImport('simple'));
$('#htmlUseMainBtn').addEventListener('click', () => useHtmlImport('main'));
$('#htmlImportCancelBtn').addEventListener('click', () => {
  $('#htmlImportModal').classList.remove('open');
  state.htmlImportState = null;
});
$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (isHtmlFile(file)) {
      await importHtmlFileOptions(file);
    } else {
      const data = await importFileObject(file);
      applyImportedText(data, file.name, fileDisplaySize(file.size));
    }
  } catch (err) {
    toast(err.message);
    alert(err.message);
  }
  e.target.value = '';
});
$('#importUrlBtn').addEventListener('click', () => {
  $('#urlModal').classList.add('open');
  $('#urlStatus').textContent = 'Ready.';
  setTimeout(() => $('#urlInput').focus(), 0);
});
$('#urlCancelBtn').addEventListener('click', () => $('#urlModal').classList.remove('open'));
$('#urlInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#urlFetchBtn').click();
  }
});
$('#urlFetchBtn').addEventListener('click', async () => {
  const url = $('#urlInput').value.trim();
  if (!url) {
    toast('Enter a URL first.');
    return;
  }
  try {
    $('#urlFetchBtn').disabled = true;
    $('#urlStatus').textContent = 'Fetching URL...';
    const res = await api('/api/import_url', { url });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'URL import failed');
    $('#urlModal').classList.remove('open');
    $('#urlInput').value = '';
    openHtmlImportChoice(data, { displayName: data.filename || 'URL import', url: data.url || url });
    $('#urlStatus').textContent = 'Ready.';
  } catch (err) {
    $('#urlStatus').textContent = err.message;
    toast(err.message);
  } finally {
    $('#urlFetchBtn').disabled = false;
  }
});
function renderMergeList() {
  const list = $('#mergeList');
  if (!list) return;
  list.innerHTML = '';
  if (!state.mergeFiles.length) {
    list.innerHTML = '<div class="empty-hint">No supported files found in that folder.</div>';
    return;
  }
  state.mergeFiles.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'merge-row';
    row.innerHTML = `<div><div class="merge-name">${escapeHtml(item.path)}</div><div class="merge-meta">${idx + 1}. ${item.text.length.toLocaleString()} chars · ${(item.notes || []).join(' · ')}</div></div><div class="merge-actions"><button data-act="up" ${idx === 0 ? 'disabled' : ''}>Up</button><button data-act="down" ${idx === state.mergeFiles.length - 1 ? 'disabled' : ''}>Down</button></div>`;
    row.querySelector('[data-act="up"]').addEventListener('click', () => {
      if (idx > 0) {
        [state.mergeFiles[idx - 1], state.mergeFiles[idx]] = [state.mergeFiles[idx], state.mergeFiles[idx - 1]];
        renderMergeList();
      }
    });
    row.querySelector('[data-act="down"]').addEventListener('click', () => {
      if (idx < state.mergeFiles.length - 1) {
        [state.mergeFiles[idx + 1], state.mergeFiles[idx]] = [state.mergeFiles[idx], state.mergeFiles[idx + 1]];
        renderMergeList();
      }
    });
    list.appendChild(row);
  });
  $('#mergeSub').textContent = `${state.mergeFiles.length} file(s) ready. Use Up/Down to choose order.`;
}
$('#folderInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || [])
    .filter(isMergeableFile)
    .sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );
  if (!files.length) {
    toast('No supported files found.');
    e.target.value = '';
    return;
  }
  state.mergeFiles = [];
  $('#mergeStatus').textContent = 'Importing files...';
  $('#mergeModal').classList.add('open');
  try {
    for (let i = 0; i < files.length; i++) {
      $('#mergeStatus').textContent = `Importing ${i + 1}/${files.length}: ${files[i].name}`;
      state.mergeFiles.push(await importFileObject(files[i]));
      renderMergeList();
    }
    $('#mergeStatus').textContent = 'Arrange order, then merge.';
  } catch (err) {
    $('#mergeStatus').textContent = err.message;
    toast(err.message);
  }
  e.target.value = '';
});
$('#mergeCancelBtn').addEventListener('click', () => {
  $('#mergeModal').classList.remove('open');
  state.mergeFiles = [];
});
$('#mergeBtn').addEventListener('click', () => {
  if (!state.mergeFiles.length) {
    toast('No files to merge.');
    return;
  }
  if (editor.value && !confirm('Replace the current editor text with the merged folder?')) return;
  snapshotBefore('Before merging a folder');
  pushUndoSnapshot();
  const merged = state.mergeFiles
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n');
  editor.value = merged;
  state.currentFilename = 'merged-manuscript.md';
  filenameEl.textContent = `merged folder (${state.mergeFiles.length} files)`;
  $('#metaFilename').value = $('#metaFilename').value || 'merged-manuscript';
  undoStack.length = 0;
  updateUndoButton();
  updateStats();
  $('#mergeModal').classList.remove('open');
  toast('Folder merged. You can now export DOCX.');
});
$('#clearBtn').addEventListener('click', () => {
  if (editor.value && !confirm('Clear the editor?')) return;
  snapshotBefore('Before clearing the editor');
  pushUndoSnapshot();
  editor.value = '';
  state.currentFilename = 'manuscript.txt';
  filenameEl.textContent = 'empty document';
  $('#metaFilename').value = '';
  updateStats();
});
$('#exportTxtBtn').addEventListener('click', () => {
  const base = cleanFilename($('#metaFilename').value || state.currentFilename.replace(/\.[^.]+$/, ''));
  downloadBlob(new Blob([stripMarkers(editor.value)], { type: 'text/plain;charset=utf-8' }), `${base}-clean.txt`);
});
$('#exportMarkedTxtBtn').addEventListener('click', () => {
  const base = cleanFilename($('#metaFilename').value || state.currentFilename.replace(/\.[^.]+$/, ''));
  downloadBlob(new Blob([editor.value], { type: 'text/markdown;charset=utf-8' }), `${base}-markdown.md`);
});
$('#exportDocxBtn').addEventListener('click', async () => {
  try {
    const base = cleanFilename($('#metaFilename').value || state.currentFilename.replace(/\.[^.]+$/, ''));
    const res = await api('/api/export_docx', {
      text: editor.value,
      metadata: getMetadata(),
      filename: base,
      options: { lists: $('#docxLists').checked },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(data.error || 'Export failed');
    }
    const blob = await res.blob();
    downloadBlob(blob, `${base}-formatted.docx`);
    toast('DOCX exported');
  } catch (err) {
    alert(err.message);
    toast(err.message);
  }
});
