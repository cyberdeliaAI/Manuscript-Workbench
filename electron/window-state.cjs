'use strict';
// Remembers the size and position of the main window between starts. No dependencies.
const fs = require('node:fs');
const path = require('node:path');

const LIMIT = 50000; // anything bigger is a damaged file, not a window
const SAVE_DELAY = 500;
const VISIBLE = { width: 100, height: 60 }; // how much of a saved window must still be on a screen

const whole = (value) => Number.isInteger(value) && Math.abs(value) <= LIMIT;
const extent = (value) => whole(value) && value > 0;

/** The saved state, or null when there is none or the file is missing, damaged or too big. */
function readState(file) {
  try {
    if (!file || fs.statSync(file).size > 4096) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const state = { isMaximized: data.isMaximized === true, isFullScreen: data.isFullScreen === true };
    if (extent(data.width) && extent(data.height)) {
      state.width = data.width;
      state.height = data.height;
      if (whole(data.x) && whole(data.y)) {
        state.x = data.x;
        state.y = data.y;
      }
    }
    return state;
  } catch {
    return null; // the first start, or a file we cannot use: start with the defaults
  }
}

/** Writes through a temporary file, so a crash cannot leave half a file behind. */
function writeState(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch {
    return false; // remembering the window is optional; it must never get in the way of using it
  }
}

function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

/** True when enough of the window is on some screen, and its top edge (the title bar) can still be reached. */
function onSomeScreen(bounds, workAreas) {
  return workAreas.some((area) => {
    const shared = overlap(bounds, area);
    return (
      shared.width >= Math.min(VISIBLE.width, bounds.width) &&
      shared.height >= Math.min(VISIBLE.height, bounds.height) &&
      bounds.y >= area.y - 8 &&
      bounds.y <= area.y + area.height - 40
    );
  });
}

/**
 * The window options for this start: the saved bounds when they still land on a connected screen, otherwise the
 * default size centred on the primary screen. `workAreas` are the work areas of all displays.
 */
function chooseWindow(saved, defaults, workAreas, primary = workAreas[0]) {
  const minWidth = Math.min(defaults.minWidth, primary.width);
  const minHeight = Math.min(defaults.minHeight, primary.height);
  let bounds = null;
  if (saved && saved.width && saved.x !== undefined) {
    const candidate = {
      x: saved.x,
      y: saved.y,
      width: Math.max(minWidth, saved.width),
      height: Math.max(minHeight, saved.height),
    };
    if (onSomeScreen(candidate, workAreas)) bounds = candidate;
  }
  if (!bounds) {
    const width = Math.max(minWidth, Math.min(defaults.width, primary.width));
    const height = Math.max(minHeight, Math.min(defaults.height, primary.height));
    bounds = {
      x: primary.x + Math.round((primary.width - width) / 2),
      y: primary.y + Math.round((primary.height - height) / 2),
      width,
      height,
    };
  }
  return {
    options: { ...bounds, minWidth, minHeight },
    isMaximized: !!saved?.isMaximized,
    isFullScreen: !!saved?.isFullScreen,
  };
}

/** Saves the state a moment after the window was moved, resized, (un)maximized or put in full screen, and on close. */
function trackWindow(window, file, { delay = SAVE_DELAY, write = writeState } = {}) {
  let timer;
  const save = () => {
    clearTimeout(timer);
    if (window.isDestroyed()) return;
    const { x, y, width, height } = window.getNormalBounds(); // the normal size, not the maximized one
    if (![x, y].every(whole) || ![width, height].every(extent)) return;
    write(file, { x, y, width, height, isMaximized: window.isMaximized(), isFullScreen: window.isFullScreen() });
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, delay);
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'])
    window.on(event, later);
  window.on('close', save);
  window.on('closed', () => clearTimeout(timer));
  return save;
}

module.exports = { readState, writeState, chooseWindow, trackWindow, onSomeScreen };
