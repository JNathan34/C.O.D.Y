'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {findFile}=require('electron-updater/out/providers/Provider');
const config=require('../../../electron-builder.standalone.cjs');
test('packaging produces separate, uniquely named Windows installers',()=>{
  assert.equal(config.nsis.buildUniversalInstaller,false);
  assert.ok(config.win.artifactName.includes('${arch}'));
  assert.deepEqual(config.win.target[0].arch,['x64','arm64']);
});
for(const arch of ['x64','arm64'])test(`updater selects the ${arch} installer from shared metadata`,()=>{
  const descriptor=Object.getOwnPropertyDescriptor(process,'arch');
  try{
    Object.defineProperty(process,'arch',{...descriptor,value:arch});
    const files=['x64','arm64'].map(architecture=>({url:new URL(`https://example.com/C.O.D.Y-Setup-0.15.2-${architecture}.exe`),info:{url:`C.O.D.Y-Setup-0.15.2-${architecture}.exe`}}));
    assert.ok(findFile(files,'exe').url.pathname.endsWith(`-${arch}.exe`));
  }finally{Object.defineProperty(process,'arch',descriptor);}
});
