'use strict';
const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'..');
const extension=path.join(root,'run/current/CODYBrowserExtension');
for(const name of fs.readdirSync(extension))if(/\.(html|js|mjs|css)$/.test(name)&&name!=='mark.js'){
 const file=path.join(extension,name);let text=fs.readFileSync(file,'utf8').replaceAll('HeyClicky','CODY').replaceAll('com.heyclicky.browser','com.cody.browser').replaceAll('heyclicky://settings/browser','cody://settings/browser').replaceAll('heyclickyBridge','codyBridge').replaceAll('heyclickyModelView','codyModelView').replaceAll('your Mac','your PC').replaceAll('Settings → Integrations → Chrome','Settings → Plugins → Chrome');fs.writeFileSync(file,text);
}
const file=path.join(extension,'manifest.json'),manifest=JSON.parse(fs.readFileSync(file));
manifest.name='CODY’s browser extension';manifest.short_name='CODY';manifest.description='Connect Chrome or Edge to CODY for help with websites and tabs.';manifest.action.default_title='CODY';delete manifest.homepage_url;manifest.version='0.6.5';fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
for(const size of [16,32,48,128])for(const name of [size+'.png','toolbar-'+size+'.png']){
 const icon=path.join(extension,'icons',name);if(fs.existsSync(icon))fs.copyFileSync(path.join(root,'frontend/original-cody/assets/brand/cody-256.png'),icon);
}
fs.writeFileSync(path.join(extension,'mark.js'),`export function createMark(host,{width=24}={}){const img=document.createElement('img');img.src='icons/128.png';img.alt='';img.style.cssText='width:'+width+'px;height:'+width+'px;object-fit:contain';host.replaceChildren(img);return {blink(){},setWorking(active){img.style.opacity=active?'.85':'1';}};}\n`);
console.log('CODY extension branding applied; native host identity and extension key retained.');
