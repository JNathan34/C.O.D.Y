'use strict';
const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NativeEngine } = require('../frontend/original-cody/src/native-engine');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cody-drawing-follow-')));
app.on('window-all-closed', () => {});
const engine = new NativeEngine();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function focusFixture(window) {
  window.show();
  window.focus();
  if (process.env.CODY_DRAWING_FIXTURE_MANUAL) {
    console.log('Focus fixture window: ' + window.getTitle());
    for (let attempt = 0; attempt < 120 && !window.isFocused(); attempt++) await wait(500);
  }
  assert.equal(window.isFocused(), true, 'the requested drawing fixture owns the foreground');
  return window.getNativeWindowHandle().readBigUInt64LE().toString();
}

async function until(label, predicate) {
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    state = await request('drawing-controls-state');
    if (state.error) throw Error(state.error);
    const marks = state.follow?.marks || [];
    if (predicate(marks, state)) {
      console.log('PASS: ' + label);
      return marks;
    }
    await wait(100);
  }
  throw Error(label + ' timed out: ' + JSON.stringify(state));
}

async function request(command, args) {
  let timer;
  try {
    return await Promise.race([engine.request(command, args), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(command + ' timed out')), 12000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

app.whenReady().then(async () => {
  let page, other, fixture = false;
  try {
    app.setAccessibilitySupportEnabled(true);
    await engine.refresh();
    const primary = screen.getPrimaryDisplay();
    const { x, y, width, height } = primary.workArea;
    page = new BrowserWindow({ x: x + 12, y: y + 12, width: Math.min(width - 24, 900),
      height: Math.min(height - 24, 750), show: false, backgroundColor: '#fff' });
    const html = `<!doctype html><title>Drawing test question one</title>
      <style>
        body{font:24px Arial;margin:0;padding:140px 30px;min-height:1500px;background:white}
        button,label,p{position:relative;display:block;margin:35px 0;width:94%;box-sizing:border-box;padding:14px;
          font:700 25px Arial;text-align:center;border:1px solid #333;background:#fafafa;color:#111}
        input{position:absolute;left:4%;top:50%;transform:translate(-50%,-50%);margin:0;width:18px;height:18px}
      </style>
      <label id="first"><input type="radio" name="question">Quartz minerals fracture across uneven layers</label>
      <button id="second">Amphibians migrate between ponds every spring</button>
      <p id="sketch">An illustration of branching rivers and estuaries</p>`;
    await page.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pageHandle = await focusFixture(page);
    await wait(300);
    const bounds = page.getContentBounds();
    const monitor = screen.dipToScreenPoint(primary.bounds);
    const area = { width: primary.bounds.width * primary.scaleFactor,
      height: primary.bounds.height * primary.scaleFactor };
    const boxes = await page.webContents.executeJavaScript(`['first','second','sketch'].map(id=>{
      const r=document.getElementById(id).getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height};
    })`);
    const physical = boxes.map(box => {
      const start = screen.dipToScreenPoint({ x: Math.round(bounds.x + box.x), y: Math.round(bounds.y + box.y) });
      return { ...start, width: box.width * primary.scaleFactor, height: box.height * primary.scaleFactor };
    });
    await request('drawing-controls-test-highlight', { marks: physical.map(box => ({
      x: (box.x - monitor.x) / area.width, y: (box.y - monitor.y) / area.height,
      width: box.width / area.width, height: box.height / area.height,
    })) });
    fixture = true;
    const initial = await until('recognising two controls and the illustration', (marks, state) => {
      if (state.follow?.owner) assert.equal(state.follow.owner, pageHandle, 'captured the fixture window');
      return marks.length === 3 && marks.every(mark => mark.anchored && mark.visible) &&
        marks.filter(mark => mark.control).length === 2;
    });
    assert.equal(initial[2].control, false);

    await page.webContents.executeJavaScript('scrollTo(0, 95)');
    await request('drawing-controls-test-screen-change', { reason: 'scroll' });
    const expectedY = -95 * primary.scaleFactor;
    const aligned = mark => mark.visible && Math.abs(mark.x) <= 4 && Math.abs(mark.y - expectedY) <= 4;
    const shifted = await until('following all three marks after scroll', marks =>
      marks.length === 3 && marks.every(aligned));

    const press = async index => {
      const box = physical[index];
      await request('drawing-controls-test-press', {
        x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2 - 95 * primary.scaleFactor),
      });
    };
    await press(2);
    await wait(350);
    await until('illustration remains after a press', marks =>
      marks.length === 3 && marks.some(mark => mark.id === shifted[2].id && mark.visible && !mark.removed));
    if (process.env.CODY_DRAWING_FIXTURE_REAL_CLICK) {
      console.log('Click the first quiz option in the fixture.');
      let pressed = false;
      for (let attempt = 0; attempt < 90 && !pressed; attempt++) {
        await wait(500);
        pressed = await page.webContents.executeJavaScript("document.querySelector('input').checked");
      }
      assert.equal(pressed, true, 'the mouse press reached the page through the overlay');
    } else {
      await press(0);
    }
    await wait(500);
    await until('only the selected control is dismissed', marks =>
      marks.length === 2 && marks.every(mark => mark.id !== shifted[0].id && aligned(mark)));

    other = new BrowserWindow({ width: 340, height: 260, show: false });
    await other.loadURL('data:text/html,<title>Other drawing test window</title>');
    await focusFixture(other);
    await until('screen marks hide in another window', marks =>
      marks.length === 2 && marks.every(mark => !mark.visible));
    other.hide();
    await focusFixture(page);
    await until('marks restore in the original window', marks =>
      marks.length === 2 && marks.every(mark => mark.visible));

    const originalWindow = page.getBounds();
    const beforeMove = await until('recording the original window geometry', marks =>
      marks.length === 2 && marks.every(aligned));
    page.setPosition(originalWindow.x + 36, originalWindow.y + 24);
    const movedWindow = page.getBounds();
    assert.notEqual(movedWindow.x, originalWindow.x, 'the fixture window actually moved');
    const moved = await until('marks follow the window move', marks => marks.length === 2 &&
      marks.every((mark, index) => mark.id === beforeMove[index].id && mark.visible &&
        Math.abs(mark.box.X - beforeMove[index].box.X - (movedWindow.x - originalWindow.x) * primary.scaleFactor) < 5 &&
        Math.abs(mark.box.Y - beforeMove[index].box.Y - (movedWindow.y - originalWindow.y) * primary.scaleFactor) < 5));
    page.setSize(movedWindow.width - 80, movedWindow.height);
    await until('the circled button resizes with its target', marks => marks.length === 2 &&
      marks[0].visible && marks[0].id === moved[0].id && marks[1].id === moved[1].id && !marks[1].removed &&
      marks[0].box.Width < moved[0].box.Width - 30 * primary.scaleFactor);
    page.setSize(movedWindow.width, movedWindow.height);
    await until('the original marks restore at the previous window size', marks => marks.length === 2 &&
      marks.every((mark, index) => mark.id === moved[index].id && mark.visible &&
        Math.abs(mark.box.X - moved[index].box.X) < 5 && Math.abs(mark.box.Width - moved[index].box.Width) < 5));

    await page.webContents.executeJavaScript("document.title='Drawing test question two'");
    await wait(400);
    await until('a title update preserves marks on the same content', marks => marks.length === 2 &&
      marks.every((mark, index) => mark.id === moved[index].id && mark.visible));
    await page.webContents.executeJavaScript(`document.querySelector('#second').textContent='Completely different question content and layout';
      document.querySelector('#sketch').remove();`);
    await until('same-title content replacement hides old marks', marks =>
      marks.length === 2 && marks.every(mark => !mark.visible));
    console.log('PASS: independent native tracking, scroll, selective dismissal, window switching and content replacement.');
  } catch (error) {
    console.error(error);
    app.exitCode = 1;
  } finally {
    if (fixture) await request('model-zoom-demo-clear').catch(() => {});
    other?.destroy();
    page?.destroy();
    engine.close();
    await wait(600);
    app.exit(app.exitCode || 0);
  }
});
