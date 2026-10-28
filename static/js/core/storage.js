// Storage layer with an injectable backend. Never throws.
export function createStorage(backend, prefix = 'mwb.', legacyPrefix = 'vp.py.') {
  const attempt = (fn, fallback = null) => {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  };
  return {
    get(name) {
      const current = attempt(() => backend.getItem(prefix + name));
      if (current !== null && current !== undefined) return current;
      const legacy = attempt(() => backend.getItem(legacyPrefix + name));
      if (legacy !== null && legacy !== undefined) {
        attempt(() => backend.setItem(prefix + name, legacy));
        return legacy;
      }
      return null;
    },
    set(name, value) {
      return attempt(() => {
        backend.setItem(prefix + name, String(value));
        return true;
      }, false);
    },
    remove(name) {
      attempt(() => {
        backend.removeItem(prefix + name);
        backend.removeItem(legacyPrefix + name);
      });
    },
  };
}
