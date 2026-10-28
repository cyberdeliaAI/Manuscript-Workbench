// Metadata, settings, autosave and recovery.
import { state } from './state.js';
import { AI_PROVIDERS, isKnownProviderBase } from '../core/ai-stream.js';
import { currentAiProvider, updateProviderUi } from './ai.js';
import { api, apiGet } from './api.js';
import { activateSideTab } from './chrome.js';
import { $, editor, toast } from './dom.js';
import { getScope } from './editor-ops.js';
import { setGlossaryText } from './glossary.js';
import { updateStats } from './stats.js';
import { storage } from './storage.js';

export function getMetadata() {
  return {
    title: $('#metaTitle').value.trim(),
    subtitle: $('#metaSubtitle').value.trim(),
    author: $('#metaAuthor').value.trim(),
    language: $('#metaLanguage').value.trim(),
    series: $('#metaSeries').value.trim(),
    bookNumber: $('#metaBookNumber').value.trim(),
    publisher: $('#metaPublisher').value.trim(),
    filename: $('#metaFilename').value.trim(),
  };
}
export function setMetadata(m) {
  m = m || {};
  $('#metaTitle').value = m.title || '';
  $('#metaSubtitle').value = m.subtitle || '';
  $('#metaAuthor').value = m.author || '';
  $('#metaLanguage').value = m.language || '';
  $('#metaSeries').value = m.series || '';
  $('#metaBookNumber').value = m.bookNumber || '';
  $('#metaPublisher').value = m.publisher || '';
  $('#metaFilename').value = m.filename || '';
}
export function scheduleAutosave() {
  if (state.recoveryPending && !editor.value) {
    return;
  }
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => {
    if (state.recoveryPending && !editor.value) return;
    try {
      const settings = getSettings();
      delete settings.lmApiKey;
      const data = {
        version: 1,
        text: editor.value,
        metadata: getMetadata(),
        settings,
        savedAt: new Date().toISOString(),
      };
      if (!storage.set('autosave', JSON.stringify(data))) throw new Error('storage unavailable');
    } catch (err) {
      if (!state.autosaveWarningShown) {
        state.autosaveWarningShown = true;
        toast('Autosave failed: browser storage is full. Export your work to disk.');
      }
    }
  }, 700);
}
export function getSettings() {
  return {
    wrap: $('#wrapToggle').checked,
    previewOn: document.querySelector('.editor-card')?.classList.contains('preview-on') || false,
    scope: getScope(),
    structureToolsCollapsed: $('#structureToolbar').classList.contains('collapsed'),
    sideTab: document.querySelector('[data-side-tab].active')?.dataset.sideTab || 'check',
    lmProvider: $('#lmProvider')?.value || 'lmstudio',
    lmBase: $('#lmBase').value,
    lmApiKey: $('#lmApiKey').value,
    lmModel: $('#lmModel').value,
    lmStrength: $('#lmStrength')?.value || 'medium',
    chunkSize: $('#chunkSize').value,
    autoRetry: $('#autoRetry')?.value || '1',
    guidedContext: $('#guidedContext')?.value || '',
    translateTarget: $('#translateTarget')?.value || 'English',
    advTemperature: $('#advTemperature')?.value || '',
    advTopP: $('#advTopP')?.value || '',
    advTopK: $('#advTopK')?.value || '',
    advRepeatPenalty: $('#advRepeatPenalty')?.value || '',
    advMaxTokens: $('#advMaxTokens')?.value || '',
    allowRemoteImages: $('#allowRemoteImages')?.checked || false,
    ignoredCandidates: state.ignoredCandidates,
    glossary: state.projectGlossary,
    quoteStyle: $('#quoteStyle')?.value || 'auto',
    dashStyle: $('#dashStyle')?.value || 'auto',
  };
}
export function saveSettings() {
  if (state.settingsLoading) return;
  const settings = getSettings();
  try {
    storage.set('settings', JSON.stringify(settings));
  } catch (err) {}
  clearTimeout(state.settingsSaveTimer);
  state.settingsSaveTimer = setTimeout(() => {
    const serverSettings = { ...settings };
    delete serverSettings.lmApiKey; // the key stays in the browser; the server never stores it
    api('/api/settings', { settings: serverSettings }).catch(() => {});
  }, 350);
  scheduleAutosave();
}
export async function loadSettings() {
  state.settingsLoading = true;
  let s = {};
  try {
    s = JSON.parse(storage.get('settings') || '{}');
  } catch (e) {}
  try {
    const res = await apiGet('/api/settings');
    if (res.ok) {
      const data = await res.json();
      if (data && data.settings) s = { ...s, ...data.settings };
    }
  } catch (e) {}
  try {
    storage.set('settings', JSON.stringify(s));
  } catch (e) {}
  $('#wrapToggle').checked = !!s.wrap;
  $('#wrapToggle').dispatchEvent(new Event('change'));
  const card = document.querySelector('.editor-card');
  card.classList.toggle('preview-on', !!s.previewOn);
  $('#togglePreview').classList.toggle('active', !!s.previewOn);
  const scopeInput = document.querySelector(
    `input[name="scope"][value="${s.scope === 'selection' ? 'selection' : 'all'}"]`,
  );
  if (scopeInput) scopeInput.checked = true;
  const tb = $('#structureToolbar');
  // `vellumCollapsed` is the name older versions saved this setting under
  const collapsed = (s.structureToolsCollapsed ?? s.vellumCollapsed) !== false;
  tb.classList.toggle('collapsed', collapsed);
  $('#toggleStructureTools').textContent = collapsed ? 'Expand' : 'Collapse';
  const rawTab = s.sideTab || storage.get('sideTab') || 'check';
  const savedTab = rawTab === 'vellum' ? 'markdown' : rawTab; // the tab was called 'vellum' in older versions
  activateSideTab(document.querySelector(`[data-side-tab="${savedTab}"]`) ? savedTab : 'check');
  if (s.lmProvider && AI_PROVIDERS[s.lmProvider]) $('#lmProvider').value = s.lmProvider;
  if (s.lmBase) $('#lmBase').value = s.lmBase;
  else $('#lmBase').value = currentAiProvider().base;
  if (s.lmApiKey) $('#lmApiKey').value = s.lmApiKey;
  updateProviderUi();
  if (s.lmModel) {
    const sel = $('#lmModel');
    if (!Array.from(sel.options).some((o) => o.value === s.lmModel)) {
      const opt = document.createElement('option');
      opt.value = s.lmModel;
      opt.textContent = s.lmModel;
      sel.appendChild(opt);
    }
    sel.value = s.lmModel;
  }
  if (s.lmStrength) $('#lmStrength').value = s.lmStrength;
  if (s.chunkSize) $('#chunkSize').value = s.chunkSize;
  if (s.autoRetry) $('#autoRetry').value = String(s.autoRetry);
  if (s.guidedContext) $('#guidedContext').value = s.guidedContext;
  if (s.translateTarget) $('#translateTarget').value = s.translateTarget;
  $('#allowRemoteImages').checked = !!s.allowRemoteImages;
  if (Array.isArray(s.ignoredCandidates))
    state.ignoredCandidates = s.ignoredCandidates.filter((k) => typeof k === 'string');
  if (typeof s.glossary === 'string') setGlossaryText(s.glossary);
  if (s.quoteStyle) $('#quoteStyle').value = s.quoteStyle;
  if (s.dashStyle) $('#dashStyle').value = s.dashStyle;
  ['advTemperature', 'advTopP', 'advTopK', 'advRepeatPenalty', 'advMaxTokens'].forEach((id) => {
    if (s[id]) $('#' + id).value = s[id];
  });
  state.settingsLoading = false;
}
[
  'metaTitle',
  'metaSubtitle',
  'metaAuthor',
  'metaLanguage',
  'metaSeries',
  'metaBookNumber',
  'metaPublisher',
  'metaFilename',
  'lmBase',
  'lmApiKey',
  'lmModel',
  'chunkSize',
  'guidedContext',
  'translateTarget',
  'advTemperature',
  'advTopP',
  'advTopK',
  'advRepeatPenalty',
  'advMaxTokens',
].forEach((id) =>
  $('#' + id).addEventListener('input', () => {
    saveSettings();
    updateStats();
  }),
);
$('#lmProvider').addEventListener('change', () => {
  const base = $('#lmBase').value.trim();
  const provider = currentAiProvider();
  if (!base || isKnownProviderBase(base)) $('#lmBase').value = provider.base;
  updateProviderUi();
  saveSettings();
});
$('#lmStrength').addEventListener('change', saveSettings);
$('#quoteStyle').addEventListener('change', saveSettings);
$('#dashStyle').addEventListener('change', saveSettings);
$('#allowRemoteImages').addEventListener('change', () => {
  saveSettings();
  toast('Reload the page to apply the image setting.');
});
$('#lmModel').addEventListener('change', saveSettings);
export function showRecoveryIfNeeded() {
  const raw = storage.get('autosave');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data.text && !editor.value) {
      state.recoveryData = data;
      state.recoveryPending = true;
      $('#recovery').classList.add('show');
    }
  } catch (e) {}
}
$('#restoreBtn').addEventListener('click', () => {
  const data = state.recoveryData || JSON.parse(storage.get('autosave') || '{}');
  state.recoveryPending = false;
  editor.value = data.text || '';
  setMetadata(data.metadata || {});
  if (data.settings) {
    try {
      storage.set('settings', JSON.stringify(data.settings));
      loadSettings();
    } catch (e) {}
  }
  $('#recovery').classList.remove('show');
  updateStats();
  toast(`Autosave restored: ${(editor.value.match(/\S+/g) || []).length.toLocaleString()} words`);
});
$('#discardRestoreBtn').addEventListener('click', () => {
  state.recoveryPending = false;
  state.recoveryData = null;
  storage.remove('autosave');
  $('#recovery').classList.remove('show');
  updateStats();
});

// The elements behind the settings that travel with a project (see PROJECT_SETTING_KEYS).
const PROJECT_SETTING_FIELDS = {
  lmProvider: '#lmProvider',
  lmBase: '#lmBase',
  lmStrength: '#lmStrength',
  chunkSize: '#chunkSize',
  guidedContext: '#guidedContext',
  translateTarget: '#translateTarget',
  quoteStyle: '#quoteStyle',
  dashStyle: '#dashStyle',
  advTemperature: '#advTemperature',
  advTopP: '#advTopP',
  advTopK: '#advTopK',
  advRepeatPenalty: '#advRepeatPenalty',
  advMaxTokens: '#advMaxTokens',
};
/** Applies the settings stored in a project (opening a project). Keys the project does not have are left alone. */
export function applyProjectSettings(settings) {
  const s = settings || {};
  if (s.lmProvider && !AI_PROVIDERS[s.lmProvider]) delete s.lmProvider;
  for (const [key, selector] of Object.entries(PROJECT_SETTING_FIELDS)) {
    if (s[key] !== undefined && $(selector)) $(selector).value = String(s[key]);
  }
  if (s.lmModel) {
    const sel = $('#lmModel');
    if (!Array.from(sel.options).some((o) => o.value === s.lmModel)) {
      const opt = document.createElement('option');
      opt.value = s.lmModel;
      opt.textContent = s.lmModel;
      sel.appendChild(opt);
    }
    sel.value = s.lmModel;
  }
  updateProviderUi();
  saveSettings();
}
