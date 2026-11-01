'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function files(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
const selected=[...files(path.join(root,'frontend/original-cody/src')),...files(path.join(root,'frontend/original-cody/ui')),...fs.readdirSync(__dirname).map(name=>path.join(__dirname,name))].filter(file=>/\.(js|cjs)$/.test(file)&&fs.statSync(file).isFile());
let failed=false;
for(const file of selected){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});
  if(result.status!==0){failed=true;console.error(path.relative(root,file)+'\n'+(result.stderr||result.error?.message||'Syntax check failed.'));}
}
console.log(`Checked ${selected.length} JavaScript source files.`);if(failed)process.exitCode=1;
