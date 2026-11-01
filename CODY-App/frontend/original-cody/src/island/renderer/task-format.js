'use strict';
(()=>{
 function inline(node,text){for(const piece of text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g)){let child;if(piece.startsWith('**')&&piece.endsWith('**')){child=document.createElement('strong');child.textContent=piece.slice(2,-2);}else if(piece.startsWith('`')&&piece.endsWith('`')){child=document.createElement('code');child.textContent=piece.slice(1,-1);}else{child=document.createTextNode(piece.replace(/\[([^\]]+)\]\([^\s)]+\)/g,'$1'));}node.append(child);}}
 function render(node,text){const fragment=document.createDocumentFragment();let code=null,list=null;
  for(const line of String(text).split(/\r?\n/)){
   if(line.trim().startsWith('```')){if(code)code=null;else{const pre=document.createElement('pre');code=document.createElement('code');pre.append(code);fragment.append(pre);}list=null;continue;}
   if(code){code.textContent+=line+'\n';continue;}if(!line.trim()){list=null;continue;}
   const heading=/^(#{1,6})\s+(.+)$/.exec(line),item=/^\s*(?:[-*•]|\d+\.)\s+(.+)$/.exec(line);let block;
   if(heading){block=document.createElement('h'+Math.min(heading[1].length+1,5));inline(block,heading[2]);list=null;fragment.append(block);}
   else if(item){if(!list){list=document.createElement('ul');fragment.append(list);}block=document.createElement('li');inline(block,item[1]);list.append(block);}
   else{list=null;block=document.createElement('p');inline(block,line);fragment.append(block);}
  }node.replaceChildren(fragment);
 }
 const summary=text=>String(text||'').replace(/```[\s\S]*?```/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*`#_]/g,'').replace(/\s+/g,' ').trim().slice(0,150);
 window.CODYTaskFormat=Object.freeze({render,summary});
})();
