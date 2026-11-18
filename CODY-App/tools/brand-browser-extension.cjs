'use strict';
const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'..');
const extension=path.join(root,'run/current/CODYBrowserExtension');
const core=path.join(extension,'core.mjs');
let browserCode=fs.readFileSync(core,'utf8');
function replaceSection(start,end,replacement){
 const first=browserCode.indexOf(start),last=browserCode.indexOf(end,first+start.length);
 if(first<0||last<0)throw Error('Unexpected browser extension source for '+start.trim());
 browserCode=browserCode.slice(0,first)+replacement+browserCode.slice(last);
}
replaceSection('const FOCUSED_FIELD = ', '\n','');
replaceSection("    if (operation === 'type') {","    // Code in the page",
`    if (operation === 'type') {
      if (typeof text !== 'string' || !text || text.length > 4000) throw new Error('Type requires 1–4,000 characters.');
      this.noteInput(tabId);
      await enterBrowserText(command, async segment => {
        await this.input(tabId, () => command('Input.insertText',{text:segment},true));
        await this.sleep(10);
      }, text);
      return {done:true};
    }
`);
replaceSection("      if (operation === 'fill') {","      let value = await call(CLICK_TARGET);",
`      if (operation === 'fill') {
        if (typeof text !== 'string' || !text || text.length > 4000) throw new Error('Text entry requires 1–4,000 characters.');
        const targetKind = await call(focusTextField,[text]);
        if (targetKind === 'selected') return {done:true};
        if (targetKind !== 'focused') throw new Error('The selected element is protected or unavailable.');
        this.noteInput(tabId);
        await enterBrowserText(command, async segment => {
          await this.input(tabId, () => command('Input.insertText',{text:segment},true));
          await this.sleep(10);
        }, text, object.objectId);
        return {done:true};
      }
`);
replaceSection('const FILL_TARGET = ', "// HeyClicky's presence", '');
fs.writeFileSync(core,"import {enterBrowserText,focusTextField} from './browser-keyboard-entry.mjs';\n"+browserCode);
fs.copyFileSync(path.join(__dirname,'browser-keyboard-entry.mjs'),path.join(extension,'browser-keyboard-entry.mjs'));
for(const name of fs.readdirSync(extension))if(/\.(html|js|mjs|css)$/.test(name)&&name!=='mark.js'){
 const file=path.join(extension,name);let text=fs.readFileSync(file,'utf8').replaceAll('HeyClicky','CODY').replaceAll('com.heyclicky.browser','com.cody.browser').replaceAll('heyclicky://settings/browser','cody://settings/browser').replaceAll('heyclickyBridge','codyBridge').replaceAll('heyclickyModelView','codyModelView').replaceAll('your Mac','your PC').replaceAll('Settings → Integrations → Chrome','Settings → Plugins → Chrome');fs.writeFileSync(file,text);
}
const file=path.join(extension,'manifest.json'),manifest=JSON.parse(fs.readFileSync(file));
manifest.name='CODY’s browser extension';manifest.short_name='CODY';manifest.description='Connect Chrome or Edge to CODY for help with websites and tabs.';manifest.action.default_title='CODY';delete manifest.homepage_url;manifest.version='0.6.6';fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
for(const size of [16,32,48,128])for(const name of [size+'.png','toolbar-'+size+'.png']){
 const icon=path.join(extension,'icons',name);if(fs.existsSync(icon))fs.copyFileSync(path.join(root,'frontend/original-cody/assets/brand/cody-256.png'),icon);
}
fs.writeFileSync(path.join(extension,'mark.js'),`export function createMark(host,{width=24}={}){const img=document.createElement('img');img.src='icons/128.png';img.alt='';img.style.cssText='width:'+width+'px;height:'+width+'px;object-fit:contain';host.replaceChildren(img);return {blink(){},setWorking(active){img.style.opacity=active?'.85':'1';}};}\n`);
console.log('CODY extension branding applied; native host identity and extension key retained.');
