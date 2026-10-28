// Language of the manuscript: Book > Language, or a suggestion detected from the text.
import { state } from './state.js';
import { $, editor } from './dom.js';
import { PROFILES, detectLanguage, normalizeLanguage } from '../core/language.js';

/** The language the typography rules use: what the author chose, else what the text looks like, else English. */
export function effectiveLanguage() {
  return normalizeLanguage($('#metaLanguage')?.value) || state.detectedLanguage || 'en';
}

/** The options every typography fix and diagnostic needs. */
export function typographyOptions() {
  return {
    language: effectiveLanguage(),
    quoteStyle: $('#quoteStyle')?.value || 'auto',
    dashStyle: $('#dashStyle')?.value || 'auto',
  };
}

let detectTimer = null;
export function scheduleLanguageDetection() {
  clearTimeout(detectTimer);
  detectTimer = setTimeout(() => {
    const before = effectiveLanguage();
    state.detectedLanguage = detectLanguage(editor.value).id;
    updateLanguageHint();
    // diagnostics depend on the language: refresh them once if a new suggestion changed the profile
    if (effectiveLanguage() !== before) document.dispatchEvent(new CustomEvent('mw:language-changed'));
  }, 700);
}

export function updateLanguageHint() {
  const chosen = normalizeLanguage($('#metaLanguage')?.value);
  const profile = PROFILES[effectiveLanguage()];
  const note = $('#profileNote');
  if (note) {
    const source = chosen ? 'Book > Language' : state.detectedLanguage ? 'suggested from the text' : 'default';
    note.textContent = `Language profile: ${profile.label} (${source})`;
  }
  const hint = $('#languageHint');
  if (!hint) return;
  const suggested = state.detectedLanguage;
  if (chosen || !suggested) {
    hint.replaceChildren();
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mini';
  button.textContent = `Set Language to ${suggested}`;
  button.addEventListener('click', () => {
    $('#metaLanguage').value = suggested;
    $('#metaLanguage').dispatchEvent(new Event('input'));
  });
  hint.replaceChildren(document.createTextNode(`The text looks ${PROFILES[suggested].label}. `), button);
}
