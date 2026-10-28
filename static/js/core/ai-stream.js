// AI provider constants and stream helpers.
export const AI_PROVIDERS = {
  lmstudio: {
    label: 'LM Studio',
    base: 'http://localhost:1234/v1',
    note: 'LM Studio provider. Load a model and start the Local Server in LM Studio, then Detect Model here.',
  },
  omlx: {
    label: 'oMLX',
    base: 'http://localhost:8000/v1',
    note: 'oMLX provider for MLX-format models on Apple Silicon. Start oMLX first, then Detect Model here.',
  },
  ollama: {
    label: 'Ollama',
    base: 'http://localhost:11434/v1',
    note: 'Ollama provider. Pull/run models in Ollama, then Detect Model here.',
  },
  custom: {
    label: 'Custom OpenAI-compatible',
    base: '',
    note: 'Custom OpenAI-compatible endpoint. Enter the base URL ending in /v1 if needed.',
  },
};
export function isKnownProviderBase(url) {
  return Object.values(AI_PROVIDERS).some((p) => p.base === url);
}
export function sanitizeLmFinalText(text) {
  let out = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  const fence = out.match(/^```(?:[a-z0-9_-]+)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) out = fence[1].trim();
  out = out.replace(/^(?:here is|here's|hier is|dit is)\b[^\n:]*:\s*\n+/i, '');
  return out;
}
export function createNdjsonParser(onEvent) {
  let buf = '';
  const dispatch = (line) => {
    const text = line.trim();
    if (!text) return;
    let event;
    try {
      event = JSON.parse(text);
    } catch (e) {
      return;
    }
    onEvent(event);
  };
  return {
    push(chunk) {
      buf += chunk;
      let at;
      while ((at = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        dispatch(line);
      }
    },
    end() {
      const rest = buf;
      buf = '';
      dispatch(rest);
    },
  };
}
export function isLocalEndpointHost(host) {
  const h = String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]),
    b = Number(m[2]);
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  );
}

function formatTokens(n) {
  return n >= 1000 ? `${+(n / 1024).toFixed(1)}k` : String(n);
}
/** The text of a model in the model list: its id and what the provider told us about it. */
export function modelLabel(id, info = {}) {
  const parts = [id];
  if (info.loaded === true) parts.push('loaded');
  else if (info.loaded === false) parts.push('not loaded');
  const context = info.contextLength || info.maxContextLength;
  if (context) parts.push(`${formatTokens(context)} context`);
  if (info.quantization) parts.push(info.quantization);
  return parts.join(' · ');
}
/** A sentence about the selected model, and the chunk size that fits its context ({ text, chunkSize }). */
export function modelHint(info, suggest) {
  if (!info) return { text: '', chunkSize: 0 };
  const number = (n) => n.toLocaleString('en-US');
  if (info.loaded === false)
    return {
      text: `Not loaded yet: the provider loads it on the first request, which can take a while.${info.maxContextLength ? ` Maximum context ${number(info.maxContextLength)} tokens.` : ''}`,
      chunkSize: 0,
    };
  const context = info.contextLength;
  if (!context) return { text: '', chunkSize: 0 };
  const chunkSize = suggest(context);
  return {
    text: `Context window ${number(context)} tokens. A chunk size of about ${number(chunkSize)} characters fits.`,
    chunkSize,
  };
}
