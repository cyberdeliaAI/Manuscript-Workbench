'use strict';
// The application menu. The roles give the standard behaviour (Cmd+C, Cmd+V, Cmd+Z, Cmd+Q ...) on every platform.

const REPOSITORY = 'https://github.com/cyberdeliaAI/Manuscript-Workbench';

function menuTemplate({ platform, packaged, appName, openHelp, showProjects, openExternal }) {
  const mac = platform === 'darwin';
  const separator = { type: 'separator' };
  const projects = { label: 'Show Projects Folder', click: showProjects };
  const appMenu = mac
    ? {
        label: appName,
        submenu: [
          { role: 'about' },
          separator,
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          separator,
          { role: 'quit' },
        ],
      }
    : null;
  const fileMenu = {
    label: 'File',
    submenu: mac ? [projects, separator, { role: 'close' }] : [projects, separator, { role: 'quit' }],
  };
  const viewMenu = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      separator,
      { role: 'togglefullscreen' },
      ...(packaged ? [] : [separator, { role: 'toggleDevTools' }]),
    ],
  };
  const helpMenu = {
    role: 'help',
    submenu: [
      { label: 'User Manual', click: openHelp },
      { label: 'Changelog', click: () => openExternal(`${REPOSITORY}/blob/main/CHANGELOG.md`) },
      { label: 'Manuscript Workbench on GitHub', click: () => openExternal(REPOSITORY) },
    ],
  };
  return [...(appMenu ? [appMenu] : []), fileMenu, { role: 'editMenu' }, viewMenu, { role: 'windowMenu' }, helpMenu];
}

module.exports = { menuTemplate, REPOSITORY };
