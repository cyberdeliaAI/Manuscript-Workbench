'use strict';
// Starts and stops the Python server (manuscript_workbench.desktop_host) and reads its ready line.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const LOG_LIMIT = 1_000_000; // the log is started afresh (the old one kept as .1) when it is bigger than this at start

const startupError = (code, message) => Object.assign(new Error(message), { code });

/** How to run the server: the frozen executable in the packaged app, the system Python from the source folder in dev. */
function backendCommand({ packaged, resourcesPath, sourceRoot, python }) {
  if (packaged) {
    const name = process.platform === 'win32' ? 'manuscript-workbench-server.exe' : 'manuscript-workbench-server';
    return { file: path.join(resourcesPath, 'backend', name), args: [] };
  }
  const venv = path.join(sourceRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const fallback = process.platform === 'win32' ? 'python' : 'python3';
  return { file: python || (fs.existsSync(venv) ? venv : fallback), args: ['-m', 'manuscript_workbench.desktop_host'] };
}

/** 2.0 and 2.0.0 are the same version. */
function sameVersion(a, b) {
  const parts = (value) => String(value).split('.').concat(['0', '0', '0']).slice(0, 3).join('.');
  return parts(a) === parts(b);
}

/** Checks the server's first line and returns { url, port }; anything unexpected is an error. */
function readyMessage(data, version) {
  if (data?.event === 'error') {
    throw startupError(data.code || 'server', data.message || 'The local server could not start.');
  }
  if (data?.event !== 'ready' || data.protocol !== 1 || !sameVersion(data.version, version)) {
    throw startupError('version', 'The local server does not match this version of Manuscript Workbench.');
  }
  const url = new URL(data.url);
  const valid =
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    url.port &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash;
  if (!valid) throw startupError('address', 'The local server reported an invalid address.');
  return { url: url.origin, port: Number(url.port) };
}

/** The port used last time (so the page keeps the same origin, and with it its browser storage), or 0 for any free one. */
function readPort(file) {
  try {
    const port = JSON.parse(fs.readFileSync(file, 'utf8')).port;
    return Number.isInteger(port) && port > 1023 && port < 65536 ? port : 0;
  } catch {
    return 0;
  }
}

function rememberPort(file, port) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ port }), { mode: 0o600 });
  } catch {
    /* the next start simply takes any free port */
  }
}

function openLog(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_LIMIT) fs.renameSync(file, `${file}.1`);
    const stream = fs.createWriteStream(file, { flags: 'a', mode: 0o600 });
    stream.on('error', () => {});
    return stream;
  } catch {
    return null;
  }
}

class Backend {
  constructor(
    command,
    { version, sourceRoot, dataDir, logFile, env = process.env, timeout = 30000, onExit = () => {} },
  ) {
    Object.assign(this, { command, version, sourceRoot, dataDir, logFile, env, timeout, onExit });
    this.stopping = false;
  }

  /** Starts the server on `port` (0 = any free port) and resolves with { url, port } when it is ready. */
  start(port = 0) {
    return new Promise((resolve, reject) => {
      this.stopping = false;
      const env = { ...this.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };
      if (this.dataDir) env.MANUSCRIPT_WORKBENCH_DATA_DIR = this.dataDir;
      if (this.sourceRoot) env.PYTHONPATH = this.sourceRoot;
      const log = this.logFile ? openLog(this.logFile) : null;
      log?.write(`\n--- ${new Date().toISOString()} starting ${this.command.file} on port ${port}\n`);
      const child = spawn(this.command.file, [...this.command.args, '--port', String(port)], {
        cwd: this.sourceRoot || path.dirname(this.command.file),
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      // Server output goes to the log file only (request lines and errors; never the text of a manuscript).
      child.stderr.on('data', (chunk) => log?.write(chunk));
      child.stdin.on('error', () => {});
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.stop().finally(() => reject(error));
      };
      const timer = setTimeout(
        () => fail(startupError('timeout', 'The local server did not become ready in time.')),
        this.timeout,
      );
      this.exited = new Promise((done) => {
        child.once('error', () => {
          fail(startupError('spawn', 'The local server could not be started.'));
          done();
        });
        child.once('exit', (code, signal) => {
          log?.write(`--- exited (code ${code}, signal ${signal})\n`);
          log?.end();
          fail(startupError('exited', 'The local server stopped before it was ready.'));
          done();
          if (!this.stopping) this.onExit({ code, signal });
        });
      });
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        if (settled) {
          log?.write(`${line}\n`);
          return;
        }
        try {
          if (line.length > 8192) throw startupError('response', 'The local server sent an invalid answer.');
          const ready = readyMessage(JSON.parse(line), this.version);
          settled = true;
          clearTimeout(timer);
          resolve(ready);
        } catch (error) {
          fail(
            error instanceof SyntaxError ? startupError('response', 'The local server sent an invalid answer.') : error,
          );
        }
      });
    });
  }

  /** Asks the server to finish (it completes the request it is handling), and kills it if it takes too long. */
  async stop(grace = 8000) {
    this.stopping = true;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode) return;
    if (child.stdin.writable) child.stdin.end('stop\n');
    const timer = setTimeout(() => this.kill(), grace);
    try {
      await this.exited;
    } finally {
      clearTimeout(timer);
    }
  }

  kill() {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode) return;
    // On Windows a plain kill leaves child processes behind; taskkill /T takes the whole tree.
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGKILL');
  }

  get pid() {
    return this.child?.pid;
  }
}

module.exports = { Backend, backendCommand, readyMessage, readPort, rememberPort, sameVersion, startupError };
