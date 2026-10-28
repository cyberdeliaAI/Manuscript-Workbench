// Language of the manuscript: Book > Language, or a suggestion detected from the text.
import { state } from './state.js';
import { PROFILES, normalizeLanguage } from '../core/language.js';
import { scheduleAnalysis } from './analysis.js';
import { $ } from './dom.js';

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

/** Called with the language the analysis suggested for the text ('' when it is not sure). */
export function applyDetectedLanguage(id) {
  const before = effectiveLanguage();
  state.detectedLanguage = id || '';
  updateLanguageHint();
  // the diagnostics depend on the language: look again once if the suggestion changed the profile
  if (effectiveLanguage() !== before) scheduleAnalysis(0);
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
