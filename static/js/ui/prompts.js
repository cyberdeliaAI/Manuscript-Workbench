// Prompt presets editor.
import { DEFAULT_PROMPTS, mergeDefaultPrompts } from '../core/prompts.js';
import { mergePrompts } from '../core/project.js';
import { $, toast } from './dom.js';
import { markProjectDirty } from './project.js';
import { storage } from './storage.js';

export function loadPrompts() {
  let prompts;
  try {
    prompts = JSON.parse(storage.get('prompts') || 'null');
  } catch (e) {}
  if (!Array.isArray(prompts) || !prompts.length) prompts = DEFAULT_PROMPTS;
  else prompts = mergeDefaultPrompts(prompts);
  const sel = $('#promptSelect');
  sel.innerHTML = '';
  prompts.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  sel._prompts = prompts;
  try {
    storage.set('prompts', JSON.stringify(prompts));
  } catch (e) {}
  sel.value = storage.get('promptIndex') || 0;
  if (!prompts[sel.value]) sel.value = 0;
  $('#promptText').value = prompts[sel.value].text;
}
export function getPrompts() {
  return $('#promptSelect')._prompts || DEFAULT_PROMPTS;
}
/** Adds the prompts of a project to the list; a prompt with the same name is replaced by the project's. */
export function applyProjectPrompts(incoming) {
  if (!incoming || !incoming.length) return;
  storage.set('prompts', JSON.stringify(mergePrompts(getPrompts(), incoming)));
  loadPrompts();
}
function savePrompts() {
  storage.set('prompts', JSON.stringify($('#promptSelect')._prompts || DEFAULT_PROMPTS));
  storage.set('promptIndex', $('#promptSelect').value || 0);
  markProjectDirty();
}
$('#promptSelect').addEventListener('change', () => {
  const p = $('#promptSelect')._prompts[$('#promptSelect').value];
  $('#promptText').value = p ? p.text : '';
  savePrompts();
});
$('#savePromptBtn').addEventListener('click', () => {
  const prompts = $('#promptSelect')._prompts;
  prompts[$('#promptSelect').value].text = $('#promptText').value;
  savePrompts();
  toast('Prompt saved');
});
$('#savePromptAsBtn').addEventListener('click', () => {
  const name = prompt('Prompt name?');
  if (!name) return;
  const prompts = $('#promptSelect')._prompts;
  prompts.push({ name, text: $('#promptText').value });
  savePrompts();
  loadPrompts();
  $('#promptSelect').value = prompts.length - 1;
  savePrompts();
  toast('Prompt added');
});
$('#deletePromptBtn').addEventListener('click', () => {
  const prompts = $('#promptSelect')._prompts;
  const current = prompts[Number($('#promptSelect').value)];
  if (current && DEFAULT_PROMPTS.some((p) => p.name === current.name)) {
    toast('Built-in prompts cannot be deleted. Edit it, or use Reset Defaults.');
    return;
  }
  if (prompts.length <= 1) {
    toast('Keep at least one prompt.');
    return;
  }
  prompts.splice(Number($('#promptSelect').value), 1);
  savePrompts();
  loadPrompts();
});
$('#resetPromptsBtn').addEventListener('click', () => {
  if (!confirm('Reset prompts to defaults?')) return;
  storage.set('prompts', JSON.stringify(DEFAULT_PROMPTS));
  storage.set('promptIndex', '0');
  loadPrompts();
});
