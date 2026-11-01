'use strict';
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
function copyRuntimeDependencies(root,stage,dependencies){
  const modules=path.join(root,'node_modules'),copied=new Set();
  function copy(name,from){
    const resolver=createRequire(path.join(from,'package.json'));
    let directory;
    try{directory=path.dirname(resolver.resolve(name+'/package.json'));}
    catch{directory=path.dirname(resolver.resolve(name));while(!fs.existsSync(path.join(directory,'package.json')))directory=path.dirname(directory);}
    if(copied.has(directory))return;
    const relative=path.relative(modules,directory);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Dependency outside workspace node_modules: '+name);
    copied.add(directory);
    fs.cpSync(directory,path.join(stage,'node_modules',relative),{recursive:true});
    const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
    for(const dependency of Object.keys(pkg.dependencies||{}))copy(dependency,directory);
  }
  for(const name of Object.keys(dependencies))copy(name,root);
  return copied.size;
}
module.exports={copyRuntimeDependencies};
