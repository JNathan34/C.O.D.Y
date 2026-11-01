'use strict';
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.CODYTaskAppearance=value;})(typeof window==='object'?window:globalThis,()=>{
 const profiles={
  whatsapp:{label:'WhatsApp',color:'#25d366',kind:'message'},word:{label:'Word',color:'#4285ed',kind:'document'},excel:{label:'Excel',color:'#2cb67d',kind:'spreadsheet'},powerpoint:{label:'PowerPoint',color:'#ef865d',kind:'presentation'},spotify:{label:'Spotify',color:'#1ed760',kind:'music'},discord:{label:'Discord',color:'#939dff',kind:'message'},mail:{label:'Email',color:'#ef7169',kind:'message'},browser:{label:'Website',color:'#5fa9ff',kind:'website'},images:{label:'Images',color:'#c899ff',kind:'images'},download:{label:'Files',color:'#f0b968',kind:'download'},task:{label:'Task',color:'#9bafff',kind:'task'}
 };
 function describe(task,preview={}){
  const title=String(task.title||'').toLowerCase(),files=[...(preview.files||[]),...(preview.outputs||[]).map(x=>x.name)].join(' ').toLowerCase();let app;const context=(title+' '+String(task.preview||'')+' '+String(task.progress||'')).toLowerCase();
  if(/whats\s?app/.test(context))app='whatsapp';
  else if(/\bdiscord\b/.test(context))app='discord';
  else if(/\bspotify\b/.test(context))app='spotify';
  else if(/\b(email|e-mail|gmail|outlook)\b/.test(title))app='mail';
  else if(/\.(xlsx?|csv)\b/.test(files)||/\b(excel|spreadsheet)\b/.test(title))app='excel';
  else if(/\.pptx?\b/.test(files)||/\b(powerpoint|slide deck|presentation)\b/.test(title))app='powerpoint';
  else if(/\.docx?\b/.test(files)||/\b(word|document|documentation|report|brief|essay|letter)\b/.test(title))app='word';
  else if(preview.kind==='website'||/\b(website|webpage|web page|landing page|chrome|edge|firefox)\b/.test(title))app='browser';
  else if(preview.kind==='images'||/\b(images?|photos?|pictures?|logo|poster)\b/.test(title))app='images';
  else if(/\b(download|archive|files)\b/.test(title))app='download';
  else if(/\b(messaging|message|chat|reply)\b/.test(title))app='message';
  else app='task';
  const profile=profiles[app]||{label:'Messages',color:'#68bdc9',kind:'message'};
  return {...profile,app,icon:profiles[app]&&['whatsapp','word','excel','powerpoint','spotify','discord','mail'].includes(app)?'assets/task-apps/'+app+'.png':app==='task'?'../../../assets/brand/cody-256.png':null};
 }
 return Object.freeze({describe});
});
