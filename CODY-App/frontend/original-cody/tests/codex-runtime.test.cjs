'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {executable}=require('../src/codex-runtime');
test('standalone Codex account reads find the bundled native engine runtime without PATH',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cody-codex-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const resourcesPath=path.join(root,'resources'),options={resourcesPath,architecture:'arm64',appRoot:root};
 assert.equal(executable(options),null);
 const bundled=path.join(resourcesPath,'native-engine/CodexRuntime/bin/codex.exe');fs.mkdirSync(path.dirname(bundled),{recursive:true});fs.writeFileSync(bundled,'fixture');assert.equal(executable(options),bundled);
 const preferred=path.join(resourcesPath,'codex/arm64/bin/codex.exe');fs.mkdirSync(path.dirname(preferred),{recursive:true});fs.writeFileSync(preferred,'fixture');assert.equal(executable(options),preferred);
});
