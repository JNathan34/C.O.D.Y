'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=async context=>{
 const root=path.resolve(__dirname,'..'),resources=path.join(context.appOutDir,'resources');
 const entries=JSON.parse(fs.readFileSync(path.join(root,'build/engine-manifest.json')));
 for(const entry of entries){const file=path.join(resources,'native-engine',entry.path);if(!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==entry.sha256)throw Error('Bundled engine integrity failure: '+entry.path);}
 const asar=require(path.resolve(root,'node_modules/@electron/asar'));
 for(const file of ['src/updates.js','src/island/renderer/updates.js','node_modules/electron-updater/out/main.js','src/native-engine.js','src/task-previews.js','src/native-layout.js','src/native-links.js','src/island/renderer/index.html','src/island/renderer/assistant.js','src/island/renderer/background-tasks.js','src/island/renderer/browser-setup.js','src/island/renderer/background-tasks.css','node_modules/ws/index.js'])if(!asar.extractFile(path.join(resources,'app.asar'),path.normalize(file)).length)throw Error('Missing C.O.D.Y. application file: '+file);
 for(const file of ['windows/app-layout.ps1','windows/telemetry-snapshot.ps1','windows/ctrl-alt-listener.ps1','windows/spotify-media.ps1','windows/discord-control.ps1'])if(!fs.existsSync(path.join(resources,'app.asar.unpacked',file)))throw Error('Missing unpacked control script: '+file);
 fs.writeFileSync(path.join(root,'reports/standalone-package-'+context.arch+'.json'),JSON.stringify({passed:true,directory:context.appOutDir,engineFiles:entries.length},null,2));
 console.log('Standalone package audit passed: '+entries.length+' engine files plus C.O.D.Y. GUI.');
};
