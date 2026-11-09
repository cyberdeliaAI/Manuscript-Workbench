'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applicationUrl, externalUrl, helpUrl, permissionAllowed } = require('../security.cjs');

const ORIGIN = 'http://127.0.0.1:50123';

test('only the front page of our own server is the application', () => {
  for (const url of [`${ORIGIN}/`, `${ORIGIN}/index.html`, `${ORIGIN}/#section`])
    assert.equal(applicationUrl(url, ORIGIN), true, url);
  for (const url of [
    `${ORIGIN}/help`,
    `${ORIGIN}/?x=1`,
    `${ORIGIN}/api/settings`,
    'http://127.0.0.1:50124/',
    'http://localhost:50123/',
    'https://127.0.0.1:50123/',
    'http://user:pw@127.0.0.1:50123/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'nonsense',
    '',
  ])
    assert.equal(applicationUrl(url, ORIGIN), false, url);
});

test('the user manual is /help on our own server', () => {
  assert.equal(helpUrl(`${ORIGIN}/help`, ORIGIN), true);
  assert.equal(helpUrl(`${ORIGIN}/help#contents`, ORIGIN), true);
  for (const url of [
    `${ORIGIN}/help?x=1`,
    `${ORIGIN}/helpful`,
    `${ORIGIN}/`,
    'http://127.0.0.1:1/help',
    'https://example.org/help',
  ])
    assert.equal(helpUrl(url, ORIGIN), false, url);
});

test('only https and mailto links leave the app', () => {
  assert.equal(externalUrl('https://example.org/a?b=1'), 'https://example.org/a?b=1');
  assert.equal(externalUrl('mailto:a@example.org'), 'mailto:a@example.org');
  for (const url of [
    'http://example.org',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pw@example.org',
    `https://example.org/${'a'.repeat(9000)}`,
    'data:text/html,<b>x</b>',
    null,
    undefined,
    '',
  ])
    assert.equal(externalUrl(url), null, String(url).slice(0, 40));
});

test('the page may only write text to the clipboard', () => {
  const contents = { getURL: () => `${ORIGIN}/` };
  assert.equal(permissionAllowed(contents, 'clipboard-sanitized-write', `${ORIGIN}/`, {}, ORIGIN), true);
  for (const permission of [
    'media',
    'geolocation',
    'notifications',
    'clipboard-read',
    'fullscreen',
    'display-capture',
    'midi',
  ])
    assert.equal(permissionAllowed(contents, permission, `${ORIGIN}/`, {}, ORIGIN), false, permission);
  assert.equal(permissionAllowed(contents, 'clipboard-sanitized-write', 'https://example.org/', {}, ORIGIN), false);
  assert.equal(
    permissionAllowed(contents, 'clipboard-sanitized-write', `${ORIGIN}/`, { isMainFrame: false }, ORIGIN),
    false,
  );
  assert.equal(
    permissionAllowed({ getURL: () => 'https://example.org/' }, 'clipboard-sanitized-write', `${ORIGIN}/`, {}, ORIGIN),
    false,
  );
  assert.equal(permissionAllowed(null, 'clipboard-sanitized-write', `${ORIGIN}/`, {}, ORIGIN), false);
});
