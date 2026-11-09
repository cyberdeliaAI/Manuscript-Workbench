'use strict';
// Manuscript Workbench as a desktop app: a window around the local Python server.
const { app, BrowserWindow, Menu, dialog, session, shell, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Backend, backendCommand, readPort, rememberPort } = require('./backend.cjs');
const { menuTemplate } = require('./menu.cjs');
const { applicationUrl, externalUrl, helpUrl, permissionAllowed } = require('./security.cjs');
const { chooseWindow, readState, trackWindow } = require('./window-state.cjs');
const packageInfo = require('./package.json');

const APP_NAME = 'Manuscript Workbench';
const PARTITION = 'persist:manuscript-workbench';
const DEFAULT_WINDOW = { width: 1440, height: 940, minWidth: 900, minHeight: 600 };

app.setName(APP_NAME);
// A separate profile, for tests and for trying things without touching the real settings and projects.
if (process.env.MANUSCRIPT_WORKBENCH_ELECTRON_PROFILE)
  app.setPath('userData', path.resolve(process.env.MANUSCRIPT_WORKBENCH_ELECTRON_PROFILE));
app.enableSandbox();

let mainWindow = null;
let helpWindow = null;
let backend = null;
let origin = null;
let stopping = null;
let finished = false;

const userData = () => app.getPath('userData');
const iconPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '..', 'assets', 'icon-512.png');

function openExternal(value) {
  const safe = externalUrl(value);
  if (safe) shell.openExternal(safe).catch(() => dialog.showErrorBox(APP_NAME, 'The link could not be opened.'));
}

function showProjects() {
  const folder = path.join(userData(), 'projects');
  fs.mkdirSync(folder, { recursive: true });
  shell.openPath(folder);
}

function openHelp() {
  if (!origin) return;
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.show();
    helpWindow.focus();
    return;
  }
  helpWindow = new BrowserWindow({
    width: 940,
    height: 820,
    title: 'Manuscript Workbench — User Manual',
    icon: iconPath(),
    parent: mainWindow || undefined,
    backgroundColor: '#171613',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });
  guard(helpWindow.webContents, (url) => helpUrl(url, origin));
  helpWindow.on('closed', () => {
    helpWindow = null;
  });
  helpWindow.loadURL(`${origin}/help`).catch(() => helpWindow?.destroy());
}

/** Navigation rules for a window: stay on the allowed pages, send links elsewhere to the default browser. */
function guard(contents, allowed) {
  contents.setWindowOpenHandler(({ url }) => {
    if (helpUrl(url, origin)) openHelp();
    else openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (allowed(url)) return;
    event.preventDefault();
    if (helpUrl(url, origin)) openHelp();
    else openExternal(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (!allowed(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function installSession(ses) {
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    permissionAllowed(contents, permission, details?.requestingUrl || requestingOrigin, details, origin),
  );
  ses.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(permissionAllowed(contents, permission, details?.requestingUrl || contents?.getURL(), details, origin)),
  );
  ses.setDevicePermissionHandler(() => false);
}

function createWindow() {
  const stateFile = path.join(userData(), 'window-state.json');
  const displays = screen.getAllDisplays();
  const { options, isMaximized, isFullScreen } = chooseWindow(
    readState(stateFile),
    DEFAULT_WINDOW,
    displays.map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea,
  );
  mainWindow = new BrowserWindow({
    ...options,
    show: false,
    title: APP_NAME,
    icon: iconPath(),
    backgroundColor: '#171613',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });
  trackWindow(mainWindow, stateFile);
  if (isMaximized) mainWindow.maximize();
  if (isFullScreen) mainWindow.setFullScreen(true);
  const contents = mainWindow.webContents;
  guard(contents, (url) => applicationUrl(url, origin));
  // The page asks before it is closed with unsaved changes; without this the window could never be closed then.
  contents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Keep Open', 'Close Anyway'],
      defaultId: 0,
      cancelId: 0,
      title: APP_NAME,
      message: 'Close Manuscript Workbench with unsaved changes?',
      detail: 'Changes that are not saved to a project or exported can be lost. The browser copy (autosave) is kept.',
    });
    if (choice === 1) event.preventDefault();
  });
  contents.on('render-process-gone', () => {
    if (!stopping) dialog.showErrorBox(APP_NAME, 'The window stopped unexpectedly. Start the app again.');
    app.quit();
  });
  contents.on('did-fail-load', (_event, _code, _description, url, isMainFrame) => {
    if (isMainFrame && origin && url.startsWith(origin) && !stopping)
      fatal('The page of the local server could not be loaded.');
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('page-title-updated', (event) => event.preventDefault()); // the window keeps the name of the app
  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));
}

function installMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate({
        platform: process.platform,
        packaged: app.isPackaged,
        appName: app.name,
        openHelp,
        showProjects,
        openExternal,
      }),
    ),
  );
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: packageInfo.version,
    copyright: 'Cyberdelia',
  });
}

function fatal(message) {
  if (stopping) return;
  const log = path.join(userData(), 'logs', 'backend.log');
  dialog.showErrorBox(`${APP_NAME} could not start`, `${message}\n\nDetails are in:\n${log}`);
  mainWindow?.destroy();
  app.quit();
}

async function startBackend() {
  const sourceRoot = app.isPackaged ? null : path.resolve(__dirname, '..');
  const portFile = path.join(userData(), 'backend-port.json');
  backend = new Backend(
    backendCommand({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      sourceRoot,
      python: process.env.MANUSCRIPT_WORKBENCH_PYTHON,
    }),
    {
      version: packageInfo.version,
      sourceRoot,
      dataDir: userData(),
      logFile: path.join(userData(), 'logs', 'backend.log'),
      onExit: () => fatal('The local server stopped unexpectedly.'),
    },
  );
  const preferred = readPort(portFile);
  let ready;
  try {
    ready = await backend.start(preferred);
  } catch (error) {
    // The port of last time is taken by something else: any free port will do (the browser storage of the page starts empty then).
    if (error.code !== 'port' || !preferred) throw error;
    ready = await backend.start(0);
  }
  rememberPort(portFile, ready.port);
  return ready;
}

app.on('before-quit', (event) => {
  if (finished) return;
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close(); // the page may ask about unsaved changes first
    return;
  }
  stopping ||= (async () => {
    await backend?.stop();
    finished = true;
    app.quit();
  })();
});
app.on('window-all-closed', () => app.quit());

if (!app.requestSingleInstanceLock()) {
  finished = true;
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app
    .whenReady()
    .then(async () => {
      if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(iconPath());
      installMenu();
      createWindow();
      const ready = await startBackend();
      if (stopping) return;
      origin = ready.url;
      installSession(session.fromPartition(PARTITION));
      await mainWindow.loadURL(origin);
      if (process.env.MANUSCRIPT_WORKBENCH_SMOKE_REPORT)
        require('./smoke.cjs').run({
          app,
          window: mainWindow,
          origin,
          backend,
          report: process.env.MANUSCRIPT_WORKBENCH_SMOKE_REPORT,
        });
    })
    .catch((error) => fatal(error?.message || 'Something went wrong while starting.'));
}
