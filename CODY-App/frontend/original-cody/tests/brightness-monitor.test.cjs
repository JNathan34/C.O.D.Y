'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {BrightnessMonitor,parseBrightnessLine}=require('../src/brightness-monitor');

test('only valid WMI brightness reports become percentages',()=>{
  assert.equal(parseBrightnessLine('CODY_BRIGHTNESS:0'),0);
  assert.equal(parseBrightnessLine('CODY_BRIGHTNESS:87'),87);
  assert.equal(parseBrightnessLine('CODY_BRIGHTNESS:100\r'),100);
  for(const line of ['', 'Unexpected', 'CODY_BRIGHTNESS:-1', 'CODY_BRIGHTNESS:101','CODY_BRIGHTNESS:80%'])
    assert.equal(parseBrightnessLine(line),null);
});

test('unsupported systems do not launch a brightness watcher',()=>{
  const monitor=new BrightnessMonitor({platform:'linux',spawnProcess:()=>{throw Error('must not spawn')}});
  assert.equal(monitor.start(),false);
});

test('WMI event lines display the changed level once, even when split across chunks',()=>{
  const child=new EventEmitter();
  child.stdout=new EventEmitter();
  child.stderr=new EventEmitter();
  child.killed=false;
  child.kill=()=>{child.killed=true;child.emit('exit',0)};
  let spawnArgs;
  const monitor=new BrightnessMonitor({platform:'win32',spawnProcess:(...args)=>{spawnArgs=args;return child}});
  const levels=[];
  monitor.on('change',n=>levels.push(n));
  assert.equal(monitor.start(),true);
  assert.equal(spawnArgs[0],'powershell.exe');
  child.stdout.emit('data',Buffer.from('CODY_BRIGHT'));
  child.stdout.emit('data',Buffer.from('NESS:46\r\nCODY_BRIGHTNESS:46\nCODY_BRIGHTNESS:52\n'));
  child.stdout.emit('data',Buffer.from('CODY_BRIGHTNESS:404\n'));
  assert.deepEqual(levels,[46,52]);
  monitor.stop();
  assert.equal(child.killed,true);
  assert.equal(monitor.child,null);
});
