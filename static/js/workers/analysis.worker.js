// Web Worker: runs the text analysis (core/analysis.js) off the main thread so typing never waits for it.
import { analyzeText, transferables } from '../core/analysis.js';

self.onmessage = (event) => {
  const { id, text, options } = event.data;
  try {
    const started = performance.now();
    const result = analyzeText(text, options);
    result.ms = performance.now() - started;
    self.postMessage({ id, result }, transferables(result));
  } catch (error) {
    self.postMessage({ id, error: String((error && error.message) || error) });
  }
};
