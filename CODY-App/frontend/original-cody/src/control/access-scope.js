'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function ancestorDirectory(file){let current=file;while(!fs.existsSync(current)){const parent=path.dirname(current);if(parent===current)throw Error('File location is unavailable');current=parent;}return fs.statSync(current).isDirectory()?current:path.dirname(current);}
function canonical(file){
  const ancestor=ancestorDirectory(file),real=fs.realpathSync(ancestor);
  return path.resolve(real,path.relative(ancestor,file));
}
function within(root,file){const relative=path.relative(root,file);return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));}
function accessScope(level,selectedRoot,action,args){
  if(!['full','advanced'].includes(level))return {root:selectedRoot,args};
  const base=selectedRoot||os.homedir(),clean={...args};
  if(action==='file.restore')return {root:args.backupRoot?fs.realpathSync(args.backupRoot):base,args:clean};
  const keys=['path','destination'].filter(key=>typeof args[key]==='string');
  if(!keys.length)return {root:base,args:clean};
  const targets=keys.map(key=>{
    const value=args[key];if(value.includes('\0')||value.length>1024||/^\\\\[?.]\\/.test(value)||/^[A-Za-z]:[^\\/]/.test(value))throw Error('Invalid file path');
    return canonical(path.resolve(base,value));
  });
  let root=ancestorDirectory(targets[0]);
  for(const target of targets){
    if(path.parse(root).root.toLowerCase()!==path.parse(target).root.toLowerCase())throw Error('Cross-drive transfers are not supported by this file tool. Source and destination must share a drive.');
    while(!within(root,target)){const parent=path.dirname(root);if(parent===root)throw Error('File location is unavailable');root=parent;}
  }
  root=fs.realpathSync(root);
  keys.forEach((key,i)=>{clean[key]=path.relative(root,targets[i])||'.';});
  return {root,args:clean};
}
module.exports={accessScope};
