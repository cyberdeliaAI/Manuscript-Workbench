'use strict';
// What the desktop window may load, open and ask for. Everything else is refused.

function parse(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const plain = (url) => !url.username && !url.password;

/** The app's own page: the front page of our local server, nothing with a query. */
function applicationUrl(value, origin) {
  const url = parse(value);
  return !!url && url.origin === origin && plain(url) && ['/', '/index.html'].includes(url.pathname) && !url.search;
}

/** The user manual, which the server renders at /help. It opens in a window of its own. */
function helpUrl(value, origin) {
  const url = parse(value);
  return !!url && url.origin === origin && plain(url) && url.pathname === '/help' && !url.search;
}

/** Links that leave the app go to the default browser or mail program, never into the app window. */
function externalUrl(value) {
  const url = typeof value === 'string' && value.length <= 8192 ? parse(value) : null;
  if (!url || !plain(url)) return null;
  return url.protocol === 'https:' || url.protocol === 'mailto:' ? url.href : null;
}

/** The page may put text on the clipboard; it needs nothing else (no camera, location, notifications...). */
function permissionAllowed(contents, permission, requestingUrl, details, origin) {
  return (
    !!contents &&
    applicationUrl(contents.getURL(), origin) &&
    applicationUrl(requestingUrl, origin) &&
    details?.isMainFrame !== false &&
    permission === 'clipboard-sanitized-write'
  );
}

module.exports = { applicationUrl, helpUrl, externalUrl, permissionAllowed };
