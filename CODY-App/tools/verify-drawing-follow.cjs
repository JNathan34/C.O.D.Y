'use strict';
const { app, BrowserWindow, BrowserView, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash}=require('node:crypto');
const { NativeEngine } = require('../frontend/original-cody/src/native-engine');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cody-drawing-follow-')));
app.on('window-all-closed', () => {});
const engine = new NativeEngine();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let firstFocus = true;
const passedChecks=[];

async function focusFixture(window) {
  window.setAlwaysOnTop(true);
  window.show();
  window.moveTop();
  window.focus();
  window.webContents.focus();
  if (process.env.CODY_DRAWING_FIXTURE_MANUAL) {
    console.log('Focus fixture window: ' + window.getTitle());
    if (firstFocus) await wait(20000);
  }
  firstFocus = false;
  assert.equal(window.isVisible(), true, 'the fixture must be visible; launch Electron without windowsHide');
  assert.equal(window.isFocused(), true, 'the requested drawing fixture owns the foreground');
  return window.getNativeWindowHandle().readBigUInt64LE().toString();
}

async function restoreFixture(window) {
  const restored=new Promise(resolve=>window.once('restore',resolve));
  window.restore();
  await Promise.race([restored,wait(1500)]);
  await wait(200); // Let Chromium process WasShown before requesting focus.
  assert.equal(window.isMinimized(),false,'the fixture actually restored');
  await focusFixture(window);
  console.log('Restored fixture:',await window.webContents.executeJavaScript(
    '({visibility:document.visibilityState,focused:document.hasFocus()})'));
}

async function until(label, predicate) {
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    state = await request('drawing-controls-state');
    if (state.error) throw Error(state.error);
    const marks = state.follow?.marks || [];
    if (predicate(marks, state)) {
      console.log('PASS: ' + label);
      passedChecks.push(label);
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
  let page, other, otherTab, fixture = false;
  try {
    app.setAccessibilitySupportEnabled(true);
    await engine.refresh();
    const primary = screen.getPrimaryDisplay();
    const { x, y, width, height } = primary.workArea;
    page = new BrowserWindow({ x: x + 12, y: y + 12, width: Math.min(width - 24, 900),
      height: Math.min(height - 24, 750), show: false, backgroundColor: '#fff',
      webPreferences:{backgroundThrottling:false} });
    const speakerImage = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160"><rect width="260" height="160" fill="white"/><rect x="20" y="35" width="220" height="70" rx="12" fill="#222"/><text x="130" y="77" text-anchor="middle" font-size="17" fill="#aaa">SPEAKER</text></svg>`).toString('base64');
    const html = `<!doctype html><title>Drawing test question one</title>
      <style>
        body{font:24px Arial;margin:0;padding:140px 30px;min-height:1500px;background:white}
        button,label,p{position:relative;display:block;margin:35px 0;width:94%;box-sizing:border-box;padding:14px;
          font:700 25px Arial;text-align:center;border:1px solid #333;background:#fafafa;color:#111}
        input{position:absolute;left:4%;top:50%;transform:translate(-50%,-50%);margin:0;width:18px;height:18px}
        img{display:block;margin:35px 0;width:260px;height:160px}
      </style>
      <label id="first"><input type="radio" name="question">Quartz minerals fracture across uneven layers</label>
      <button id="second">Amphibians migrate between ponds every spring</button>
      <img id="sketch" src="${speakerImage}" alt="Speaker photograph with white padding">`;
    await page.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pageHandle = await focusFixture(page);
    await wait(300);
    const bounds = page.getContentBounds();
    const monitor = screen.dipToScreenPoint(primary.bounds);
    const area = { width: primary.bounds.width * primary.scaleFactor,
      height: primary.bounds.height * primary.scaleFactor };
    const boxes = await page.webContents.executeJavaScript(`['first','second','sketch'].map(id=>{
      const r=document.getElementById(id).getBoundingClientRect();
      return id==='sketch'?{x:r.x+20,y:r.y+35,width:220,height:70}:
        {x:r.x,y:r.y,width:r.width,height:r.height};
    })`);
    const physical = boxes.map(box => {
      const start = screen.dipToScreenPoint({ x: Math.round(bounds.x + box.x), y: Math.round(bounds.y + box.y) });
      return { ...start, width: box.width * primary.scaleFactor, height: box.height * primary.scaleFactor };
    });
    await focusFixture(page);
    await request('drawing-controls-test-highlight', { window:pageHandle, marks: physical.map(box => ({
      x: (box.x - monitor.x) / area.width, y: (box.y - monitor.y) / area.height,
      width: box.width / area.width, height: box.height / area.height,
    })) });
    fixture = true;
    const initial = await until('recognising two controls and a tight ring around a padded speaker image', (marks, state) => {
      if (state.follow?.owner) assert.equal(state.follow.owner, pageHandle, 'captured the fixture window');
      return marks.length === 3 && marks.every(mark => mark.anchored && mark.visible) &&
        marks.filter(mark => mark.control).length === 2;
    });
    assert.equal(initial[2].control, false);
    await until('the Clear control appears with the real drawing',(_,state)=>state.clearVisible);
    assert.equal((await request('drawing-controls-test-continuation')).allowed,true,
      'an unchanged view can continue its existing drawing');

    const duringScroll=[];
    const scrollErrors=[],providerTimes=[],actualPositions=new Set();
    let missingClear=0,missingInk=0;
    let lastFollow;
    const scrollStart=Date.now();
    while(Date.now()-scrollStart<2200){
      // Drive the owned fixture even when Windows occlusion throttles its RAF.
      const y=55+45*Math.sin((Date.now()-scrollStart)/300);
      const actual=await page.webContents.executeJavaScript(`scrollTo(0,${y});scrollY`);
      actualPositions.add(Math.round(actual));
      await request('drawing-controls-test-screen-change',{reason:'scroll'});
      const state=await request('drawing-controls-state');
      duringScroll.push(state.follow?.marks);
      lastFollow=state.follow;
      if(!state.clearVisible)missingClear++;
      if(state.renderedUnits<3)missingInk++;
      scrollErrors.push(state.follow?.marks?.length===3 ?
        Math.max(...state.follow.marks.map(mark=>Math.abs(mark.y+actual*primary.scaleFactor))) : 1e6);
      providerTimes.push(state.follow?.providerReadMs);
      await wait(12);
    }
    await page.webContents.executeJavaScript('scrollTo(0,0)');
    const positions=new Set(duringScroll.filter(marks=>marks?.length===3&&marks.every(mark=>mark.visible))
      .map(marks=>Math.round(marks[1].y/3)));
    console.log('Continuous scroll samples:',duringScroll.length,'positions:',positions.size,
      'hidden frames:',duringScroll.filter(marks=>!marks?.every(mark=>mark.visible)).length,
      'mean error px:',Math.round(scrollErrors.reduce((sum,n)=>sum+n,0)/scrollErrors.length),
      'max provider ms:',Math.max(...providerTimes),'page positions:',actualPositions.size,
      'provider samples:',lastFollow.sampleCount,'discarded:',lastFollow.discardedSamples,
      'age ms:',lastFollow.lastReadAgeMs,'provider:',lastFollow.provider);
    assert.ok(positions.size>=15,'drawings keep receiving positions during continuous scroll');
    assert.ok(duringScroll.every(marks=>marks?.length===3&&marks.every(mark=>mark.visible)),
      'in-view drawings do not blink out during continuous scroll');
    assert.equal(missingInk,0,'real native render units remain visible throughout continuous scrolling');
    assert.equal(missingClear,0,'Clear stays visible throughout in-view continuous scrolling');
    assert.ok(scrollErrors.reduce((sum,n)=>sum+n,0)/scrollErrors.length<30,
      'continuous scrolling stays close to the target rather than following only after scrolling stops');
    await until('returning from continuous scroll',marks=>marks.every(mark=>mark.visible&&Math.abs(mark.y)<4));
    assert.equal((await request('drawing-controls-test-continuation')).allowed,false,
      'a fresh request after scrolling uses a new capture basis while old ink is retained');

    for (const position of [120,30,100,0,50,95]) {
      await page.webContents.executeJavaScript(`scrollTo(0,${position})`);
      await request('drawing-controls-test-screen-change',{reason:'scroll'});
      await until('no accumulated offset at scroll '+position,marks=>marks.length===3&&
        marks.every(mark=>mark.visible&&Math.abs(mark.y+position*primary.scaleFactor)<4));
    }

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
    await until('speaker image remains after a press', marks =>
      marks.length === 3 && marks.some(mark => mark.id === shifted[2].id && mark.visible && !mark.removed));
    if (process.env.CODY_DRAWING_FIXTURE_REAL_CLICK) {
      console.log('Click the first quiz option in the fixture.');
      let pressed = false;
      for (let attempt = 0; attempt < 240 && !pressed; attempt++) {
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

    page.minimize();
    await until('minimising hides drawings without removing their IDs',marks=>
      marks.length===2&&marks.every(mark=>!mark.visible));
    await restoreFixture(page);
    await until('restoring the window restores both retained marks',marks=>
      marks.length===2&&marks.every(mark=>mark.visible));
    await page.webContents.executeJavaScript('scrollTo(0,800)');
    await request('drawing-controls-test-screen-change',{reason:'scroll'});
    await until('scrolling the targets fully out of view hides their drawings',marks=>
      marks.length===2&&marks.every(mark=>!mark.visible));
    await page.webContents.executeJavaScript('scrollTo(0,95)');
    await request('drawing-controls-test-screen-change',{reason:'scroll'});
    await until('scrolling back restores only the same target IDs',marks=>marks.length===2&&
      marks.every(mark=>mark.visible&&shifted.some(original=>original.id===mark.id)&&aligned(mark)));

    otherTab=new BrowserView({webPreferences:{backgroundThrottling:false}});
    await otherTab.webContents.loadURL('data:text/html,<title>Drawing test question one</title><h1>A different tab with the same title</h1>');
    const [tabWidth,tabHeight]=page.getContentSize();
    page.setBrowserView(otherTab);
    otherTab.setBounds({x:0,y:0,width:tabWidth,height:tabHeight});
    otherTab.webContents.focus();
    await until('same-window same-title tab replacement hides old marks',marks=>
      marks.length===2&&marks.every(mark=>!mark.visible));
    page.setBrowserView(null);
    otherTab.webContents.destroy();otherTab=null;
    page.webContents.focus();
    await until('returning to the original tab restores the same marks',marks=>
      marks.length===2&&marks.every(mark=>mark.visible));

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
    await request('model-zoom-demo-clear');fixture=false;
    await until('explicit Clear removes rendered ink and the Clear control',(_,state)=>
      !state.showing&&state.renderedUnits===0&&!state.clearVisible);
    await page.webContents.executeJavaScript('scrollTo(0,0)');
    page.minimize();await wait(200);await restoreFixture(page);
    await wait(400);
    await until('cleared drawings do not return after scroll and restore',(_,state)=>
      !state.showing&&state.renderedUnits===0&&!state.clearVisible);
    const report={testedAt:new Date().toISOString(),mode:'owned Electron page with real native engine',
      displayScale:primary.scaleFactor,realPointerClick:!!process.env.CODY_DRAWING_FIXTURE_REAL_CLICK,
      continuousScroll:{samples:duringScroll.length,distinctPositions:positions.size,
        hiddenFrames:duringScroll.filter(marks=>marks?.length!==3||!marks.every(mark=>mark.visible)).length,
        missingRenderedInkFrames:missingInk,
        missingClearFrames:missingClear,meanMaxTargetErrorPhysicalPixels:scrollErrors.reduce((sum,n)=>sum+n,0)/scrollErrors.length,
        maxProviderMilliseconds:Math.max(...providerTimes)},checks:passedChecks,
      engineSha256:createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../run/current/HeyClicky.dll'))).digest('hex'),
      runtimeSha256:createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../run/current/Assets/Engine/clicky-draw-engine.js'))).digest('hex'),
      notCovered:['installed Firefox acceptance','Word scrolling','multiple monitors and 100%/150% DPI']};
    fs.writeFileSync(path.resolve(__dirname,'../reports/drawing-follow-validation.json'),JSON.stringify(report,null,2));
    console.log('PASS: independent native tracking, scroll, selective dismissal, window switching and content replacement.');
  } catch (error) {
    console.error(error);
    app.exitCode = 1;
  } finally {
    if (fixture) await request('model-zoom-demo-clear').catch(() => {});
    otherTab?.webContents.destroy();
    other?.destroy();
    page?.destroy();
    engine.close();
    await wait(600);
    app.exit(app.exitCode || 0);
  }
});
