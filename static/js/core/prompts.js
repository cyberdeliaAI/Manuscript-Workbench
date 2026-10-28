// Default prompts and prompt builders.
import { structureSignature } from './structure.js';

export const DEFAULT_PROMPTS = [
  {
    name: 'Text Rewriter — balanced',
    text: `## Role\nYou are Text Rewriter, a text-cleaning and rewriting utility. Rewrite text supplied by the user into a cleaner, more readable version.\n\n## Rules\nPreserve meaning, events, outcomes, scene order, structure, tone, point of view, tense, character dynamics, and level of detail. Rewrite every part in order; do not summarize, skip, add scenes, add explanations, or moralize. Preserve chapter titles, headings, lists, scene breaks, and dialogue paragraphing. Use clear, natural, modern prose.\n\nRewrite strength: medium.\nOutput only the rewritten text.`,
  },
  {
    name: 'AI Cleanup — conservative',
    text: `You are a conservative manuscript cleanup utility. Clean the text without rewriting style or changing meaning. Fix typos, spacing, broken line breaks, duplicated words, inconsistent quotes, mojibake artifacts, chatbot clutter, and obvious OCR/PDF errors. Preserve all events, dialogue meaning, headings, scene breaks, sequence, POV, tense, tone, and level of detail. Do not summarize or add content. Output only the cleaned text.`,
  },
  {
    name: 'Light cleanup only',
    text: `Clean grammar, punctuation, spacing, repeated words, broken paragraphing, and obvious typos. Stay as close as possible to the original wording. Preserve all meaning, dialogue, headings, structure, POV, tense, and scene order. Output only the cleaned text.`,
  },
  {
    name: 'Humanize Rewrite — natural',
    text: `## Role
You are a natural manuscript rewriter. Rewrite the supplied text so it sounds more human, fluent, and alive while preserving the author's intent.

## Core rules
Rewrite the text. Do not merely proofread it.
Preserve meaning, events, facts, names, numbers, timeline, scene order, POV, tense, tone, character dynamics, and level of detail.
Do not summarize, skip, add new story content, moralize, explain, or comment.
Preserve Markdown structure exactly: headings (#, ##, ###), blockquotes (>), scene breaks (***), lists, tables, and fenced block lines (:::) must remain in place.
Preserve paragraph order and dialogue order. Dialogue may be smoothed, but the speaker's intent, voice, subtext, and information must stay the same.

## Style
Detect the input language. English and Dutch are fully supported. For mixed text, handle each language in its own natural register.
Remove stiff AI-like prose patterns where they weaken the text: overly formal openers, repetitive transitions, passive constructions, redundant phrases, and overlong sentences.
Use active voice where it reads better.
Split long sentences when it improves rhythm, but keep deliberate long sentences if they fit the voice.
Vary sentence openings and rhythm.
Keep contractions or natural spoken forms when they fit the tone.
Remove em dashes by default because they often make AI-written prose feel obvious. Replace them with periods, commas, parentheses, colons, or a clean sentence split. Keep an em dash only when it is clearly intentional in existing dialogue or part of a strong authorial voice.
Avoid making the prose generic, overly casual, or over-polished.

## Dutch guidance
Maak Nederlands natuurlijker en minder stijf. Vervang formele formuleringen zoals "teneinde", "indien", "met betrekking tot", "door middel van", "er dient te worden" en "het is belangrijk op te merken dat" wanneer dat natuurlijker leest.
Gebruik spreektaal alleen subtiel als de tekst daarom vraagt. Niet overdrijven.

## Output
Output only the rewritten text.`,
  },
  {
    name: 'Strong prose polish',
    text: `Polish the prose strongly while preserving every event, action, outcome, dialogue meaning, POV, tense, scene order, character dynamic, and level of detail. Do not add or remove story content. Make the prose smooth, clear, and modern without purple prose. Output only the rewritten text.`,
  },
  {
    name: 'Nederlands — clean herschrijven',
    text: `Je bent een Nederlandse tekstredacteur. Herschrijf de aangeleverde tekst naar soepel, helder modern Nederlands. Behoud betekenis, gebeurtenissen, volgorde, perspectief, tijd, toon, dialoogbetekenis, hoofdstuktitels, scene breaks en detailniveau. Niet samenvatten, niets toevoegen, niets weglaten. Output alleen de herschreven tekst.`,
  },
];
export function mergeDefaultPrompts(prompts) {
  const list = Array.isArray(prompts) ? prompts.slice() : [];
  const names = new Set(list.map((p) => p?.name).filter(Boolean));
  DEFAULT_PROMPTS.forEach((p) => {
    if (!names.has(p.name)) {
      list.push({ ...p });
      names.add(p.name);
    }
  });
  return list;
}
export function prepareTextForLm(text) {
  return { text, preserveStructure: structureSignature(text) !== '' };
}
export function buildLmUserContent(text, prep, task, strength = 'medium') {
  const isClean = task === 'clean';
  const strengthLine = !isClean && strength !== 'default' ? `Rewrite strength for this task: ${strength}.\n` : '';
  const markerLine = prep.preserveStructure
    ? 'Important: Preserve Markdown structure exactly, including heading markers (#, ##), blockquote markers (>), scene breaks (***), and fenced block lines (:::) .\n'
    : '';
  const encodingLine =
    'Use normal UTF-8 Unicode characters. Do not output mojibake sequences such as Ã©, â€™, â€œ, or â€”.\n';
  const actionLine = isClean
    ? 'Clean the following text conservatively. Preserve wording and style unless something is clearly broken. Output only the cleaned text.'
    : 'Rewrite the following text. Output only the processed text.';
  return `${strengthLine}${markerLine}${encodingLine}\n${actionLine}\n\n<<<BEGIN TEXT>>>\n${text}\n<<<END TEXT>>>`;
}
export function guidedSystemPrompt(kind) {
  if (kind === 'questions')
    return `You are a careful writing coach. Review the supplied manuscript text and ask only the clarification questions needed before improving it. Do not rewrite the text. If no clarification is needed, say that and list the main improvement priorities. Preserve privacy and do not invent missing context.`;
  if (kind === 'feedback')
    return `You are a manuscript editor. Give concrete, useful feedback on clarity, flow, tone, structure, consistency, and language. Do not rewrite the full text. Use concise numbered points with examples where helpful. Do not invent facts.`;
  if (kind === 'translate')
    return `You are a careful literary translator. Translate the supplied text into the requested target language while preserving meaning, paragraph order, Markdown structure, tone, names, numbers, dialogue intent, and scene order. Output only the translated text.`;
  return `You are a manuscript editor. Rewrite the supplied text using the user's guidance while preserving meaning, facts, names, numbers, paragraph order, Markdown structure, POV, tense, tone, and scene order. Output only the rewritten text.`;
}
export function guidedUserContent(kind, text, ctx = {}) {
  const guidance = (ctx.guidance || '').trim();
  const target = (ctx.target || '').trim() || 'English';
  if (kind === 'questions')
    return `Context / goal:\n${guidance || '(none provided)'}\n\nAsk clarification questions for this text. Do not rewrite it yet.\n\n<<<BEGIN TEXT>>>\n${text}\n<<<END TEXT>>>`;
  if (kind === 'feedback')
    return `Context / goal:\n${guidance || '(none provided)'}\n\nGive feedback only. Do not rewrite the full text.\n\n<<<BEGIN TEXT>>>\n${text}\n<<<END TEXT>>>`;
  if (kind === 'translate')
    return `Target language: ${target}\nGuidance:\n${guidance || '(none provided)'}\n\nTranslate this text. Preserve Markdown structure exactly.\n\n<<<BEGIN TEXT>>>\n${text}\n<<<END TEXT>>>`;
  return `Guidance / answers:\n${guidance || '(none provided)'}\n\nRewrite this text using the guidance. Preserve Markdown structure exactly.\n\n<<<BEGIN TEXT>>>\n${text}\n<<<END TEXT>>>`;
}
