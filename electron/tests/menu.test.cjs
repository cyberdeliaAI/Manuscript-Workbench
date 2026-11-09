'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { menuTemplate } = require('../menu.cjs');

function build(platform, packaged = true) {
  const calls = [];
  const template = menuTemplate({
    platform,
    packaged,
    appName: 'Manuscript Workbench',
    openHelp: () => calls.push('help'),
    showProjects: () => calls.push('projects'),
    openExternal: (url) => calls.push(url),
  });
  return { template, calls };
}
const labelOf = (item) => item.label || item.role;
const roles = (menu) => (menu.submenu || []).map((item) => item.role).filter(Boolean);

test('on macOS there is an app menu with about, hide and quit, and an Edit menu for the clipboard and undo', () => {
  const { template } = build('darwin');
  assert.deepEqual(template.map(labelOf), ['Manuscript Workbench', 'File', 'editMenu', 'View', 'windowMenu', 'help']);
  assert.deepEqual(roles(template[0]), ['about', 'hide', 'hideOthers', 'unhide', 'quit']);
  assert.equal(template[2].role, 'editMenu');
});

test('on Windows and Linux Quit lives in the File menu', () => {
  for (const platform of ['win32', 'linux']) {
    const { template } = build(platform);
    assert.deepEqual(template.map(labelOf), ['File', 'editMenu', 'View', 'windowMenu', 'help']);
    assert.ok(roles(template[0]).includes('quit'));
  }
});

test('the developer tools are only in the menu while developing', () => {
  const view = (packaged) => build('darwin', packaged).template.find((item) => item.label === 'View');
  assert.ok(!roles(view(true)).includes('toggleDevTools'));
  assert.ok(roles(view(false)).includes('toggleDevTools'));
});

test('the menu items do what they say', () => {
  const { template, calls } = build('linux');
  template[0].submenu.find((item) => item.label === 'Show Projects Folder').click();
  const help = template.find((item) => item.role === 'help');
  for (const item of help.submenu) item.click();
  assert.equal(calls[0], 'projects');
  assert.equal(calls[1], 'help');
  assert.match(calls[2], /^https:\/\/github\.com\/.*CHANGELOG\.md$/);
  assert.match(calls[3], /^https:\/\/github\.com\//);
});
