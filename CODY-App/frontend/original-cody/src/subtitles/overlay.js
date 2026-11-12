'use strict';

const path = require('node:path');

const DISPLAY_EVENTS = ['display-added', 'display-removed', 'display-metrics-changed'];

class SubtitleOverlay {
  constructor({BrowserWindow, screen, onError}) {
    Object.assign(this, {BrowserWindow, screen, onError});
    this.queue = [];
    this.enabled = false;
    this.suspended = false;
    this.reposition = () => {
      if (!this.window?.isVisible()) return;
      const display = this.screen.getDisplayMatching(this.window.getBounds());
      this.window.setBounds(this.bounds(display));
    };
    for (const event of DISPLAY_EVENTS) screen.on(event, this.reposition);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) this.prepare();
    else this.clear();
  }

  setSuspended(suspended) {
    this.suspended = suspended;
    if (suspended) this.clear();
  }

  bounds({workArea}) {
    const width = Math.min(720, workArea.width);
    const height = Math.min(200, workArea.height);
    return {
      x: workArea.x + Math.floor((workArea.width - width) / 2),
      y: workArea.y + Math.max(0, workArea.height - height - 16),
      width,
      height
    };
  }

  prepare() {
    if (this.window) return;
    const win = new this.BrowserWindow({
      ...this.bounds(this.screen.getPrimaryDisplay()),
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    this.window = win;
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('closed', () => {
      this.window = null;
      this.ready = false;
      this.clear();
    });
    win.loadFile(path.join(__dirname, 'index.html')).then(() => {
      if (win !== this.window) return;
      this.ready = true;
      if (this.queue.length) this.next();
    }).catch(error => {
      if (win !== this.window) return;
      win.destroy();
      this.onError(error);
    });
  }

  show({text, seconds} = {}) {
    if (!this.enabled || this.suspended || typeof text !== 'string') return;
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    // Keep long spoken lines readable without clipping or requiring interaction.
    const pages = normalized.match(/.{1,96}(?: |$)|.{1,96}/gu);
    const duration = Number.isFinite(seconds) ? seconds : 0;
    for (const page of pages) {
      this.queue.push({
        text: page.trim(),
        milliseconds: Math.max(1600, duration * 1000 * page.length / normalized.length)
      });
    }
    this.prepare();
    if (this.ready && !this.timer) this.next();
  }

  next() {
    this.timer = null;
    const page = this.queue.shift();
    if (!page) {
      this.clear();
      return;
    }
    const win = this.window;
    if (!win.isVisible()) {
      const display = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint());
      win.setBounds(this.bounds(display));
    }
    win.webContents.send('subtitle-text', page.text);
    if (!win.isVisible()) win.showInactive();
    this.timer = setTimeout(() => this.next(), page.milliseconds);
  }

  clear() {
    clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
    if (this.ready) {
      this.window.hide();
      this.window.webContents.send('subtitle-text', '');
    }
  }

  close() {
    this.clear();
    for (const event of DISPLAY_EVENTS) this.screen.off(event, this.reposition);
    this.window?.destroy();
  }
}

module.exports = {SubtitleOverlay};
