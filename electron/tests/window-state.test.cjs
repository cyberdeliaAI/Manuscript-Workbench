'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { chooseWindow, readState, trackWindow, writeState } = require('../window-state.cjs');

const DEFAULTS = { width: 1440, height: 940, minWidth: 900, minHeight: 600 };
const PRIMARY = { x: 0, y: 25, width: 1920, height: 1055 };
const SECOND = { x: 1920, y: 0, width: 2560, height: 1440 };
const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mw-window-state-'));

test('a missing, damaged or oversized file means no saved state', () => {
  const dir = folder();
  assert.equal(readState(path.join(dir, 'none.json')), null);
  for (const [name, content] of [
    ['bad.json', '{nope'],
    ['array.json', '[1]'],
    ['null.json', 'null'],
    ['big.json', ' '.repeat(5000)],
  ]) {
    fs.writeFileSync(path.join(dir, name), content);
    assert.equal(readState(path.join(dir, name)), null, name);
  }
});

test('only sane numbers are read back', () => {
  const dir = folder();
  const file = path.join(dir, 's.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ x: 10, y: 20, width: 800, height: 600, isMaximized: true, isFullScreen: 'yes' }),
  );
  assert.deepEqual(readState(file), { x: 10, y: 20, width: 800, height: 600, isMaximized: true, isFullScreen: false });
  fs.writeFileSync(file, JSON.stringify({ x: 1.5, y: 2, width: -5, height: 600 }));
  assert.deepEqual(readState(file), { isMaximized: false, isFullScreen: false });
  fs.writeFileSync(file, JSON.stringify({ width: 800, height: 600 }));
  assert.deepEqual(readState(file), { width: 800, height: 600, isMaximized: false, isFullScreen: false });
  fs.writeFileSync(file, JSON.stringify({ x: 99999999, y: 0, width: 800, height: 600 }));
  assert.equal(readState(file).x, undefined);
});

test('writing is atomic and creates the folder; a failure is reported, not thrown', () => {
  const dir = folder();
  const file = path.join(dir, 'deep', 'state.json');
  assert.equal(writeState(file, { width: 1 }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { width: 1 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json'], 'no temporary file is left');
  fs.writeFileSync(path.join(dir, 'plain'), 'x');
  assert.equal(writeState(path.join(dir, 'plain', 'state.json'), {}), false);
});

test('without saved state the window is the default size, centred on the primary screen', () => {
  const { options, isMaximized, isFullScreen } = chooseWindow(null, DEFAULTS, [PRIMARY]);
  assert.deepEqual(options, {
    x: 240,
    y: 25 + Math.round((1055 - 940) / 2),
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
  });
  assert.equal(isMaximized || isFullScreen, false);
});

test('a small screen shrinks the default size and the minimum size', () => {
  const small = { x: 0, y: 0, width: 800, height: 500 };
  const { options } = chooseWindow(null, DEFAULTS, [small]);
  assert.deepEqual([options.width, options.height, options.minWidth, options.minHeight], [800, 500, 800, 500]);
});

test('saved bounds that are still on a screen are used', () => {
  const saved = { x: 100, y: 120, width: 1200, height: 800, isMaximized: false, isFullScreen: false };
  const { options } = chooseWindow(saved, DEFAULTS, [PRIMARY]);
  assert.deepEqual([options.x, options.y, options.width, options.height], [100, 120, 1200, 800]);
});

test('bounds on a second screen are kept while it is connected and dropped when it is gone', () => {
  const saved = { x: 2200, y: 100, width: 1400, height: 900 };
  assert.equal(chooseWindow(saved, DEFAULTS, [PRIMARY, SECOND]).options.x, 2200);
  const gone = chooseWindow(saved, DEFAULTS, [PRIMARY]).options;
  assert.deepEqual([gone.x, gone.y], [240, 25 + Math.round((1055 - 940) / 2)]);
});

test('a screen to the left of the primary one has negative coordinates, and that is fine', () => {
  const left = { x: -1920, y: 0, width: 1920, height: 1080 };
  assert.equal(chooseWindow({ x: -1700, y: 50, width: 1000, height: 700 }, DEFAULTS, [PRIMARY, left]).options.x, -1700);
});

test('coordinates far off every screen fall back to the default size and position', () => {
  for (const [x, y] of [
    [20000, 100],
    [-9000, 100],
    [100, 20000],
    [100, -4000],
  ]) {
    const { options } = chooseWindow({ x, y, width: 1200, height: 800 }, DEFAULTS, [PRIMARY]);
    assert.deepEqual(
      [options.x, options.y, options.width, options.height],
      [240, 25 + Math.round((1055 - 940) / 2), 1440, 940],
      `${x},${y}`,
    );
  }
});

test('a window with its title bar above the screen is not restored there', () => {
  const { options } = chooseWindow({ x: 100, y: -300, width: 1200, height: 800 }, DEFAULTS, [PRIMARY]);
  assert.notEqual(options.y, -300);
});

test('a window that is mostly off screen but still reachable is kept', () => {
  const { options } = chooseWindow({ x: 1800, y: 200, width: 1200, height: 800 }, DEFAULTS, [PRIMARY]);
  assert.equal(options.x, 1800);
});

test('the minimum size wins over a tiny saved size', () => {
  const { options } = chooseWindow({ x: 100, y: 100, width: 200, height: 100 }, DEFAULTS, [PRIMARY]);
  assert.deepEqual([options.width, options.height], [900, 600]);
});

test('maximized and full screen are restored even when the bounds are not', () => {
  const result = chooseWindow(
    { x: 99999, y: 0, width: 1000, height: 700, isMaximized: true, isFullScreen: true },
    DEFAULTS,
    [PRIMARY],
  );
  assert.equal(result.isMaximized && result.isFullScreen, true);
  assert.notEqual(result.options.x, 99999);
});

function fakeWindow(bounds = { x: 10, y: 20, width: 1000, height: 700 }) {
  const window = new EventEmitter();
  Object.assign(window, { bounds, maximized: false, fullScreen: false, destroyed: false });
  window.getNormalBounds = () => window.bounds;
  window.isMaximized = () => window.maximized;
  window.isFullScreen = () => window.fullScreen;
  window.isDestroyed = () => window.destroyed;
  return window;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('moving and resizing is saved once, after the delay', async () => {
  const writes = [];
  const window = fakeWindow();
  trackWindow(window, 'f', { delay: 30, write: (file, state) => writes.push(state) });
  for (const event of ['resize', 'move', 'resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'])
    window.emit(event);
  assert.equal(writes.length, 0);
  await pause(80);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { x: 10, y: 20, width: 1000, height: 700, isMaximized: false, isFullScreen: false });
});

test('closing saves at once, with the normal size even when the window is maximized or in full screen', () => {
  const writes = [];
  const window = fakeWindow();
  trackWindow(window, 'f', { delay: 10000, write: (file, state) => writes.push(state) });
  window.maximized = true;
  window.fullScreen = true;
  window.emit('close');
  assert.deepEqual(writes, [{ x: 10, y: 20, width: 1000, height: 700, isMaximized: true, isFullScreen: true }]);
});

test('nothing is saved for a destroyed window, impossible bounds, or after the window is gone', async () => {
  const writes = [];
  const window = fakeWindow();
  const save = trackWindow(window, 'f', { delay: 20, write: (file, state) => writes.push(state) });
  window.destroyed = true;
  save();
  window.destroyed = false;
  window.bounds = { x: 1, y: 2, width: 0, height: 5 };
  save();
  window.bounds = { x: 1, y: 2, width: 100, height: 100 };
  window.emit('resize');
  window.emit('closed');
  await pause(60);
  assert.deepEqual(writes, []);
});

test('a real round trip through the file', () => {
  const file = path.join(folder(), 'window-state.json');
  const window = fakeWindow({ x: 300, y: 200, width: 1100, height: 750 });
  trackWindow(window, file);
  window.emit('close');
  assert.deepEqual(readState(file), {
    x: 300,
    y: 200,
    width: 1100,
    height: 750,
    isMaximized: false,
    isFullScreen: false,
  });
});
