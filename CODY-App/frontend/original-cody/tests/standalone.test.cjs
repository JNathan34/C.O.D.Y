'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {nativeLayout,unpacked}=require('../src/native-layout');
const {nativeLink,linksFromArgs}=require('../src/native-links');
test('installed C.O.D.Y. launches only its own bundled engine',()=>{
 const layout=nativeLayout({packaged:true,resourcesPath:'C:\\Apps\\C.O.D.Y\\resources',userData:'C:\\Profiles\\Test Cody',environment:{KEEP:'yes',HEYCLICKY_DATA_DIR:'old-install'}});
 assert.equal(layout.executable,path.join('C:\\Apps\\C.O.D.Y\\resources','native-engine','CODYEngine.exe'));
 assert.equal(layout.environment.HEYCLICKY_DATA_DIR,path.join('C:\\Profiles\\Test Cody','native-account'));
 assert.equal(layout.environment.CODY_ENGINE_STATE_DIR,path.join('C:\\Profiles\\Test Cody','native-state'));assert.equal(layout.environment.KEEP,'yes');assert.match(layout.pipeName,/^CODY\.Engine\.[a-f0-9]{16}$/);
});
test('separate profiles cannot attach to the same native engine',()=>{
 const one=nativeLayout({userData:'C:\\Profiles\\one',environment:{}}),two=nativeLayout({userData:'C:\\Profiles\\two',environment:{}});assert.notEqual(one.pipeName,two.pipeName);assert.equal(one.pipeName,nativeLayout({userData:'C:\\Profiles\\ONE',environment:{}}).pipeName);
 assert.equal(one.environment.HEYCLICKY_DATA_DIR,path.join('C:\\Profiles\\one','native-account'));assert.match(one.directory,/run[\\/]current$/);
});
test('native sign-in callbacks survive a cold or second app launch without accepting arbitrary protocols',()=>{
 assert.equal(nativeLink('cody://settings/browser'),'cody://settings/browser');
 const callback='heyclicky://auth-callback#access_token=fixture-only&refresh_token=fixture-only';assert.equal(nativeLink(callback),callback);assert.deepEqual(linksFromArgs(['C.O.D.Y.exe',callback,'--no-sandbox']),[callback]);
 assert.equal(nativeLink(callback.replace('heyclicky:','clicky:')),callback);
 for(const value of ['https://example.com','file:///C:/test','javascript:alert(1)','not a URL','heyclicky:',null,'heyclicky://auth-callback?'+'.'.repeat(25000)])assert.equal(nativeLink(value),null);
});
test('Windows helpers resolve to real unpacked paths when packaged',()=>{const file=path.join('C:\\Cody','resources','app.asar','windows','app-layout.ps1');assert.equal(unpacked(file),path.join('C:\\Cody','resources','app.asar.unpacked','windows','app-layout.ps1'));});
