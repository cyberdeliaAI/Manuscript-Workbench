// Entry point: loads every UI module (they wire their own event listeners) and starts the app.
// Importing a UI module is what wires its event listeners.
import './ui/chrome.js';
import './ui/undo.js';
import './ui/stats.js';
import './ui/preview.js';
import './ui/outline.js';
import './ui/editor-ops.js';
import './ui/find.js';
import './ui/markup.js';
import './ui/files.js';
import './ui/compare.js';
import './ui/preflight.js';
import './ui/clean.js';
import './ui/diagnostics.js';
import './ui/structure-panel.js';
import './ui/prompts.js';
import './ui/ai.js';
import './ui/ai-preview.js';
import './ui/settings.js';

import { loadPrompts } from './ui/prompts.js';
import { loadSettings, showRecoveryIfNeeded } from './ui/settings.js';
import { updateStats } from './ui/stats.js';

loadPrompts();
loadSettings().then(() => {
  showRecoveryIfNeeded();
  updateStats();
});
