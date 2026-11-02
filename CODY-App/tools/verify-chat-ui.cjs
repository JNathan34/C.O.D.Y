'use strict';
const {app,BrowserWindow}=require('electron'),path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const errors=[],win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 win.webContents.on('console-message',(_event,_level,message)=>{if(/Uncaught|TypeError|ReferenceError/.test(message))errors.push(message);});
 const evaluate=code=>win.webContents.executeJavaScript(code);
 const replace=text=>evaluate('window.CODYIsland.renderMessage(previewMessage,'+JSON.stringify(text)+');void 0');
 async function capture(name){win.webContents.invalidate();await new Promise(resolve=>setTimeout(resolve,350));await fs.writeFile(path.resolve(__dirname,'../reports/'+name+'.png'),(await win.webContents.capturePage()).toPNG());}
 try{
  await win.loadFile(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'true'}});
  await evaluate('window.CODYIsland.togglePanel(true);window.CODYIsland.showIsland(true);');
  const raw='<ANSWER>'+JSON.stringify({outcome:'A business report comparing three methods across three IT projects is due 23 Nov 2026.',numbers:[{value:'23 Nov',label:'Due date'},{value:'17 Dec',label:'Assessment'}],list:[{text:'Explain methods and structures',detail:'P1–P2'},{text:'Compare methods and structures',detail:'M1'},{text:'Evaluate and recommend',detail:'D1'}]})+'</ANSWER>\n<NEXT_ACTIONS>\n- Turn the brief into a work checklist\n- Make a study schedule before 23 November\n</NEXT_ACTIONS>';
  await evaluate('window.previewMessage=window.CODYIsland.appendMessage(\'assistant\','+JSON.stringify(raw)+');document.getElementById(\'conversation\').scrollTop=0;void 0');
  assert.ok(await evaluate('previewMessage.querySelectorAll(\'li\').length===7&&!previewMessage.textContent.includes(\'<ANSWER>\')'));
  await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}');await capture('chat-structured');
  const markdown='## Report checklist\n\nUse **three methods** with *clear examples*.\n\n1. Read the brief\n2. Compare the projects\n\n> Ready to share\n\n```js\nconst result = "<ANSWER>literal</ANSWER>";\n```\n\n| Method | Status |\n| --- | --- |\n| Agile | Ready |\n\n[Source](https://example.com) [unsafe](javascript:alert)\n<img src=x onerror=alert(1)>';
  await replace(markdown);
  for(const selector of ['h3','strong','em','ol','blockquote','pre code','table'])assert.ok(await evaluate('!!previewMessage.querySelector('+JSON.stringify(selector)+')'));
  assert.ok(await evaluate('previewMessage.querySelectorAll(\'a\').length===1&&!previewMessage.querySelector(\'img,script,iframe\')&&previewMessage.querySelector(\'pre\').textContent.includes(\'<ANSWER>literal</ANSWER>\')'));
  await replace('Visible text\n<ANSWER>{"outcome":"partial');assert.equal(await evaluate('previewMessage.textContent'),'Visible text');
  await replace(markdown);
  await evaluate('window.previewUser=window.CODYIsland.appendMessage(\'user\',\'**literal** <ANSWER>example</ANSWER>\');document.getElementById(\'conversation\').scrollTop=0;void 0');
  assert.ok(await evaluate('previewUser.textContent===\'**literal** <ANSWER>example</ANSWER>\'&&!previewUser.querySelector(\'strong\')'));
  const layout=await evaluate('(()=>{const c=document.getElementById(\'conversation\');return {client:c.clientWidth,scroll:c.scrollWidth}})()');assert.ok(layout.scroll<=layout.client);
  await capture('chat-markdown');assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['screenshot reply readable','Markdown styles','stream replacement','literal user messages','HTML and unsafe links inert','no horizontal overflow'],layout}));
 }catch(error){console.error(error);app.exitCode=1;}
 finally{win.destroy();app.exit(app.exitCode||0);}
});
