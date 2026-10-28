// The glossary on the Book tab: terms the AI must keep as written, and translations it must use.
import { state } from './state.js';
import { parseGlossary, suggestNames } from '../core/glossary.js';
import { $, editor, toast } from './dom.js';
import { markProjectDirty } from './project.js';
import { saveSettings } from './settings.js';

export function glossaryEntries() {
  return parseGlossary(state.projectGlossary).entries;
}

function renderGlossaryStatus() {
  const el = $('#glossaryStatus');
  if (!el) return;
  const { entries, problems } = parseGlossary(state.projectGlossary);
  const translations = entries.filter((e) => e.translation !== null).length;
  const parts = [];
  parts.push(
    entries.length
      ? `${entries.length} term${entries.length === 1 ? '' : 's'}${translations ? ` (${translations} with a translation)` : ''}`
      : 'No terms yet',
  );
  if (problems.length) parts.push(problems.map((p) => `line ${p.line}: ${p.message}`).join('; '));
  el.textContent = parts.join(' · ');
  el.classList.toggle('warn', problems.length > 0);
}

export function setGlossaryText(text) {
  state.projectGlossary = String(text || '');
  const box = $('#glossaryText');
  if (box && box.value !== state.projectGlossary) box.value = state.projectGlossary;
  renderGlossaryStatus();
}

$('#glossaryText').addEventListener('input', () => {
  state.projectGlossary = $('#glossaryText').value;
  renderGlossaryStatus();
  markProjectDirty();
  saveSettings();
});

$('#glossaryNamesBtn').addEventListener('click', () => {
  const known = glossaryEntries().flatMap((e) => [e.term, e.translation].filter(Boolean));
  const names = suggestNames(editor.value, { known });
  if (!names.length) {
    toast('No recurring names found that are not in the glossary yet.');
    return;
  }
  const current = $('#glossaryText').value.replace(/\s+$/, '');
  setGlossaryText(
    `${current}${current ? '\n\n' : ''}# Names found in the text (delete the ones you do not need)\n${names.join('\n')}\n`,
  );
  markProjectDirty();
  saveSettings();
  toast(`Added ${names.length} name${names.length === 1 ? '' : 's'} to the glossary`);
});

renderGlossaryStatus();
