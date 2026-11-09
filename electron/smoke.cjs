'use strict';
// A check of the running app, used by tools/check_desktop.py and by hand:
//   MANUSCRIPT_WORKBENCH_SMOKE_REPORT=/tmp/report.json npm start
// It waits for the page, tries what the desktop shell and the bundled Python server must be able to do, writes a
// JSON report and quits. With MANUSCRIPT_WORKBENCH_SMOKE_SCREENSHOT=/path/page.png it also saves a picture of the page.
const fs = require('node:fs');
const { screen } = require('electron');

const PAGE_CHECKS = `(async () => {
  const token = document.querySelector('meta[name="mw-token"]')?.content || '';
  const post = (path, body) =>
    fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MW-Token': token }, body: JSON.stringify(body) });
  const article = '<html><body><article><h1>A title for the article</h1>' +
    Array.from({ length: 12 }, (_, i) => '<p>Sentence ' + i + ' of an article paragraph that is long enough to survive extraction.</p>').join('') +
    '</article></body></html>';
  const out = {
    title: document.title,
    editor: !!document.querySelector('#editor'),
    token: token.length > 20,
    versionInHeader: document.querySelector('.brand .sub')?.textContent || '',
    desktopBridge: window.manuscriptWorkbenchDesktop ? { ...window.manuscriptWorkbenchDesktop } : null,
    nodeLeak: typeof require !== 'undefined' || typeof process !== 'undefined',
    worker: typeof Worker === 'function',
  };
  try {
    // Browser storage must survive a restart (the origin has to stay the same): the second run sees the first one's mark.
    out.returning = localStorage.getItem('mwb.smoke-run') === '1';
    localStorage.setItem('mwb.smoke-run', '1');
    out.localStorage = localStorage.getItem('mwb.smoke-run') === '1';
  } catch { out.localStorage = false; }
  out.health = await (await fetch('/api/health')).json();
  const html = await (await post('/api/render_markdown', { text: '# Hello *world*' })).json();
  out.markdown = /<h1[^>]*>Hello <em>world<\\/em><\\/h1>/.test(html.html);
  const docx = await post('/api/export_docx', { text: '# Chapter\\n\\n- one\\n- two\\n\\n| a | b |\\n|---|---|\\n| 1 | 2 |', metadata: { title: 'T' } });
  const bytes = new Uint8Array(await docx.arrayBuffer());
  out.docx = docx.status === 200 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const epub = await post('/api/export_epub', { text: '# Chapter\\n\\ntext', metadata: { title: 'T' } });
  out.epub = epub.status === 200 && epub.headers.get('Content-Type') === 'application/epub+zip';
  const imported = await (await post('/api/import_html_options', { filename: 'a.html', data_b64: btoa(article) })).json();
  out.trafilatura = (imported.main?.text || '').startsWith('# A title for the article') && !imported.main?.error;
  const preflight = await (await post('/api/preflight', { text: '# One\\n\\ntext', metadata: {} })).json();
  out.preflight = Array.isArray(preflight.issues);
  const guide = await fetch('/help');
  out.guide = guide.status === 200 && (await guide.text()).includes('User Guide');
  return out;
})()`;

async function waitForApp(window, origin, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const contents = window.webContents;
    if (!contents.isLoading() && contents.getURL().startsWith(origin)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The page did not load in time.');
}

/** What the window looks like now: where it was restored to, and which screens exist. */
function windowReport(window) {
  return {
    bounds: window.getBounds(),
    normalBounds: window.getNormalBounds(),
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen(),
    workAreas: screen.getAllDisplays().map((display) => display.workArea),
  };
}

/** For tests of the remembered window: MANUSCRIPT_WORKBENCH_SMOKE_LAYOUT='{"bounds":{...}}' or '{"maximize":true}'. */
async function applyLayout(window) {
  const layout = JSON.parse(process.env.MANUSCRIPT_WORKBENCH_SMOKE_LAYOUT || 'null');
  if (!layout) return;
  if (layout.bounds) window.setBounds(layout.bounds);
  if (layout.maximize) window.maximize();
  await new Promise((resolve) => setTimeout(resolve, 700));
}

async function run({ app, window, origin, backend, report }) {
  const result = { ok: false, origin, backendPid: backend.pid, packaged: app.isPackaged, version: app.getVersion() };
  try {
    await waitForApp(window, origin);
    Object.assign(result, await window.webContents.executeJavaScript(PAGE_CHECKS));
    result.windowTitle = window.getTitle();
    result.window = windowReport(window);
    result.ok = true;
    // A picture of the window's page (only the app's own content), to look at the result.
    if (process.env.MANUSCRIPT_WORKBENCH_SMOKE_SCREENSHOT)
      fs.writeFileSync(
        process.env.MANUSCRIPT_WORKBENCH_SMOKE_SCREENSHOT,
        (await window.webContents.capturePage()).toPNG(),
      );
  } catch (error) {
    result.error = String(error?.message || error);
  }
  await applyLayout(window).catch(() => {});
  fs.writeFileSync(report, JSON.stringify(result, null, 2));
  app.quit();
}

module.exports = { run };
