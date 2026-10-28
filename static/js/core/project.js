// Project files (.mwb.json): what a project contains, how it is exported and imported, and small helpers for the
// project lists. The server (manuscript_workbench/project.py) validates everything again; this side only has to
// build and read the format.

export const PROJECT_FORMAT = 'manuscript-workbench-project';
export const PROJECT_VERSION = 1;

// The AI and typography settings that travel with a project (never secrets, never window layout).
export const PROJECT_SETTING_KEYS = [
  'lmProvider',
  'lmBase',
  'lmModel',
  'lmStrength',
  'chunkSize',
  'guidedContext',
  'translateTarget',
  'quoteStyle',
  'dashStyle',
  'advTemperature',
  'advTopP',
  'advTopK',
  'advRepeatPenalty',
  'advMaxTokens',
];
export const METADATA_KEYS = [
  'title',
  'subtitle',
  'author',
  'language',
  'series',
  'bookNumber',
  'publisher',
  'filename',
];

const isScalar = (v) => ['string', 'number', 'boolean'].includes(typeof v);

/** Keeps only the settings that belong in a project. */
export function pickProjectSettings(settings) {
  const out = {};
  for (const key of PROJECT_SETTING_KEYS) if (settings && isScalar(settings[key])) out[key] = settings[key];
  return out;
}

/** The prompts that are not simply the built-in ones: new ones, and built-in ones whose text was edited. */
export function customPromptsOf(prompts, defaults) {
  const builtIn = new Map((defaults || []).map((p) => [p.name, p.text]));
  return (prompts || [])
    .filter((p) => p && typeof p.name === 'string' && typeof p.text === 'string' && builtIn.get(p.name) !== p.text)
    .map((p) => ({ name: p.name, text: p.text }));
}

/** The project's prompts win over the ones with the same name; prompts only the user has stay. */
export function mergePrompts(current, incoming) {
  const merged = (current || []).map((p) => ({ ...p }));
  for (const p of incoming || []) {
    if (!p || typeof p.name !== 'string' || typeof p.text !== 'string') continue;
    const at = merged.findIndex((m) => m.name === p.name);
    if (at >= 0) merged[at] = { name: p.name, text: p.text };
    else merged.push({ name: p.name, text: p.text });
  }
  return merged;
}

/** The content of a project as it is sent to the server. */
export function buildProject({ text, metadata, glossary, ignoredCandidates, prompts, defaults, settings }) {
  const meta = {};
  for (const key of METADATA_KEYS) if (metadata && isScalar(metadata[key])) meta[key] = String(metadata[key]);
  return {
    text: String(text || ''),
    metadata: meta,
    glossary: String(glossary || ''),
    ignoredCandidates: (ignoredCandidates || []).filter((k) => typeof k === 'string'),
    customPrompts: customPromptsOf(prompts, defaults),
    settings: pickProjectSettings(settings),
  };
}

/** The file written by "Export project file". */
export function buildProjectFile(name, project, now = new Date()) {
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, name, exportedAt: now.toISOString(), ...project };
}

/** Reads the text of a project file. Returns { name, project } or throws an Error with a message for the author. */
export function parseProjectFile(source) {
  let data;
  try {
    data = typeof source === 'string' ? JSON.parse(source) : source;
  } catch (err) {
    throw new Error('This file is not valid JSON, so it is not a project file.', { cause: err });
  }
  if (!data || typeof data !== 'object' || data.format !== PROJECT_FORMAT)
    throw new Error('This is not a Manuscript Workbench project file.');
  if (!Number.isInteger(data.version) || data.version > PROJECT_VERSION)
    throw new Error('This project was made by a newer version of Manuscript Workbench.');
  if (typeof data.text !== 'string') throw new Error('This project file has no text.');
  const project = buildProject({
    text: data.text,
    metadata: data.metadata,
    glossary: data.glossary,
    ignoredCandidates: data.ignoredCandidates,
    prompts: data.customPrompts,
    defaults: [],
    settings: data.settings,
  });
  const name = String(data.name || project.metadata.title || '').trim() || 'Imported project';
  return { name, project };
}

/** A file name for an export: letters, digits, dot, dash and underscore. */
export function projectFileName(name) {
  const base = String(name || 'project')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  return `${base || 'project'}.mwb.json`;
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", else the date. */
export function describeAge(iso, now = Date.now()) {
  const then = Date.parse(iso || '');
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(then).toISOString().slice(0, 10);
}
