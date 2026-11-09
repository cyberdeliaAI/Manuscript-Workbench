'use strict';
// The one thing the page may learn about the desktop shell: that it is running in it. No IPC, no URLs, no tokens.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld(
  'manuscriptWorkbenchDesktop',
  Object.freeze({ desktop: true, platform: process.platform }),
);
