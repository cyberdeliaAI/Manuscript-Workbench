'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Backend, backendCommand, readPort, readyMessage, rememberPort, sameVersion } = require('../backend.cjs');

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mw-backend-'));
const ready = (extra = {}) => ({
  event: 'ready',
  protocol: 1,
  version: '2.0',
  url: 'http://127.0.0.1:50123',
  ...extra,
});

test('the packaged app runs the frozen server, a development checkout runs the Python module', () => {
  const packaged = backendCommand({ packaged: true, resourcesPath: '/app/Resources', sourceRoot: null });
  assert.equal(path.dirname(packaged.file), path.join('/app/Resources', 'backend'));
  assert.match(path.basename(packaged.file), /^manuscript-workbench-server(\.exe)?$/);
  assert.deepEqual(packaged.args, []);
  const dev = backendCommand({ packaged: false, resourcesPath: '', sourceRoot: folder(), python: '/opt/py' });
  assert.deepEqual(dev, { file: '/opt/py', args: ['-m', 'manuscript_workbench.desktop_host'] });
  const fallback = backendCommand({ packaged: false, resourcesPath: '', sourceRoot: folder() });
  assert.match(fallback.file, /python/);
});

test('a .venv in the source folder is preferred', () => {
  const root = folder();
  const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, '');
  assert.equal(backendCommand({ packaged: false, resourcesPath: '', sourceRoot: root }).file, python);
});

test('2.0 and 2.0.0 are one version', () => {
  assert.equal(sameVersion('2.0', '2.0.0'), true);
  assert.equal(sameVersion('2.0.1', '2.0'), false);
  assert.equal(sameVersion('2.1', '2.0.0'), false);
});

test('the ready line gives the origin and port', () => {
  assert.deepEqual(readyMessage(ready(), '2.0.0'), { url: 'http://127.0.0.1:50123', port: 50123 });
});

test('an error line carries its code, anything else unexpected is refused', () => {
  assert.throws(() => readyMessage({ event: 'error', code: 'port', message: 'busy' }, '2.0'), {
    code: 'port',
    message: 'busy',
  });
  assert.throws(() => readyMessage(ready({ protocol: 2 }), '2.0'), { code: 'version' });
  assert.throws(() => readyMessage(ready({ version: '1.2' }), '2.0'), { code: 'version' });
  assert.throws(() => readyMessage({ event: 'hello' }, '2.0'), { code: 'version' });
  assert.throws(() => readyMessage(null, '2.0'), { code: 'version' });
});

test('only a plain http://127.0.0.1:port address is accepted', () => {
  for (const url of [
    'https://127.0.0.1:50123',
    'http://localhost:50123',
    'http://0.0.0.0:50123',
    'http://127.0.0.1',
    'http://127.0.0.1:50123/app',
    'http://127.0.0.1:50123/?x=1',
    'http://user:pw@127.0.0.1:50123',
    'http://example.com:50123',
  ])
    assert.throws(() => readyMessage(ready({ url }), '2.0'), { code: 'address' }, url);
});

test('the port is remembered, and a damaged or privileged value means any free port', () => {
  const file = path.join(folder(), 'sub', 'backend-port.json');
  assert.equal(readPort(file), 0);
  rememberPort(file, 50123);
  assert.equal(readPort(file), 50123);
  for (const value of ['{"port": 80}', '{"port": "x"}', '{"port": 70000}', 'nope']) {
    fs.writeFileSync(file, value);
    assert.equal(readPort(file), 0, value);
  }
});

// A stand-in for the Python server, written in Node so the tests need nothing else.
function fake(body, port = 0) {
  const script = `
    const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 50123;
    const say = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
    ${body}
  `;
  return { file: process.execPath, args: ['-e', script, '--'] };
}
const options = (extra = {}) => ({ version: '2.0.0', sourceRoot: null, timeout: 5000, ...extra });
const polite = `
  say({ event: 'ready', protocol: 1, version: '2.0', url: 'http://127.0.0.1:' + port });
  process.stdin.on('data', (chunk) => { if (String(chunk).includes('stop')) process.exit(0); });
  process.stdin.on('end', () => process.exit(0));
`;

test('start waits for the ready line and stop ends the server', async () => {
  const dir = folder();
  const backend = new Backend(fake(polite), options({ dataDir: dir, logFile: path.join(dir, 'logs', 'backend.log') }));
  const result = await backend.start(51234);
  assert.deepEqual(result, { url: 'http://127.0.0.1:51234', port: 51234 });
  const pid = backend.pid;
  await backend.stop();
  assert.throws(() => process.kill(pid, 0), 'the server process is gone');
});

test('the server is told where to keep its data', async () => {
  const dir = folder();
  const command = fake(`
    say({ event: 'ready', protocol: 1, version: '2.0', url: 'http://127.0.0.1:' + port });
    process.stderr.write('data=' + process.env.MANUSCRIPT_WORKBENCH_DATA_DIR + '\\n');
    process.stdin.on('end', () => process.exit(0));
    process.stdin.resume();
  `);
  const log = path.join(dir, 'logs', 'backend.log');
  const backend = new Backend(command, options({ dataDir: dir, logFile: log }));
  await backend.start(0);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await backend.stop();
  assert.match(fs.readFileSync(log, 'utf8'), new RegExp(`data=${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('an error line from the server rejects with its code and the process ends', async () => {
  const command = fake(`say({ event: 'error', code: 'port', message: 'The port is busy.' }); process.exit(1);`);
  await assert.rejects(new Backend(command, options()).start(50000), { code: 'port', message: 'The port is busy.' });
});

test('a server that exits before it is ready, or never answers, is an error', async () => {
  await assert.rejects(new Backend(fake('process.exit(3);'), options()).start(), { code: 'exited' });
  await assert.rejects(new Backend(fake('process.stdin.resume();'), options({ timeout: 300 })).start(), {
    code: 'timeout',
  });
  await assert.rejects(new Backend(fake(`console.log('not json'); process.stdin.resume();`), options()).start(), {
    code: 'response',
  });
  await assert.rejects(new Backend({ file: '/does/not/exist', args: [] }, options()).start(), { code: 'spawn' });
});

test('a server that dies after it was ready is reported once', async () => {
  const exits = [];
  const command = fake(
    `say({ event: 'ready', protocol: 1, version: '2.0', url: 'http://127.0.0.1:' + port }); setTimeout(() => process.exit(5), 100);`,
  );
  const backend = new Backend(command, options({ onExit: (info) => exits.push(info) }));
  await backend.start(0);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(exits.length, 1);
  assert.equal(exits[0].code, 5);
});

test('stopping on purpose is not reported as a crash', async () => {
  const exits = [];
  const backend = new Backend(fake(polite), options({ onExit: (info) => exits.push(info) }));
  await backend.start(0);
  await backend.stop();
  assert.deepEqual(exits, []);
});

test(
  'a server that ignores the stop line is killed after the grace period',
  { skip: process.platform === 'win32' },
  async () => {
    const stubborn = `
    say({ event: 'ready', protocol: 1, version: '2.0', url: 'http://127.0.0.1:' + port });
    process.stdin.resume();
    setInterval(() => {}, 1000);
  `;
    const backend = new Backend(fake(stubborn), options());
    await backend.start(0);
    const started = Date.now();
    await backend.stop(300);
    assert.ok(Date.now() - started < 3000);
    assert.throws(() => process.kill(backend.pid, 0));
  },
);

test('the same backend can be started again after a failed start', async () => {
  const backend = new Backend(
    fake(`if (port === 1) { say({ event: 'error', code: 'port', message: 'busy' }); process.exit(1); } ${polite}`),
    options(),
  );
  await assert.rejects(backend.start(1), { code: 'port' });
  assert.deepEqual(await backend.start(50999), { url: 'http://127.0.0.1:50999', port: 50999 });
  await backend.stop();
});

test('an old log is set aside when it gets big', async () => {
  const dir = folder();
  const log = path.join(dir, 'logs', 'backend.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, 'x'.repeat(1_100_000));
  const backend = new Backend(fake(polite), options({ logFile: log }));
  await backend.start(0);
  await backend.stop();
  assert.equal(fs.statSync(`${log}.1`).size, 1_100_000);
  assert.ok(fs.statSync(log).size < 1000);
});
