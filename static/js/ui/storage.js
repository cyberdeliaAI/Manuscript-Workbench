// Browser storage with migration of the old vp.py.* keys.
import { createStorage } from '../core/storage.js';

export const storage = createStorage(
  (() => {
    try {
      return window.localStorage;
    } catch (e) {
      return null;
    }
  })(),
);
