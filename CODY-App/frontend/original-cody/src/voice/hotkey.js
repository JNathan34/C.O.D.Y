'use strict';
const path = require('node:path');
const {spawn} = require('node:child_process');
function startPushToTalk(emit) {
  const script=path.join(__dirname,'../../windows/ctrl-alt-listener.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script], {windowsHide:true, stdio:['ignore','pipe','pipe']});
  let buffer = '', held = false, stopped = false;
  const cancel = () => { held = false; if (!stopped) emit('cancel'); };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk; let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0,newline).trim(); buffer = buffer.slice(newline+1);
      if (line === 'DOWN' && !held) { held = true; emit('down'); }
      if (line === 'UP' && held) { held = false; emit('up'); }
      if (line === 'CANCEL') { held = false; emit('cancel'); }
      if (line === 'MUTE_RELEASE') emit('mute-up');
      const click=/^CLICK (-?\d+) (-?\d+)(?: (left|right|middle))?$/.exec(line);
      if(click)emit({type:'pointer',x:Number(click[1]),y:Number(click[2]),button:click[3]||'left'});
      const pointer=/^POINTER (-?\d+) (-?\d+) (left|right|middle)$/.exec(line);
      if(pointer)emit({type:'pointer',x:Number(pointer[1]),y:Number(pointer[2]),button:pointer[3],physicalPixels:true});
    }
  });
  child.stderr.on('data', data => console.warn('CODY shortcut:',String(data).slice(0,500)));
  child.on('error', error => { console.warn('CODY shortcut unavailable:',error.message); cancel(); });
  child.on('exit', cancel);
  return () => { stopped = true; child.kill(); };
}
module.exports = {startPushToTalk};
