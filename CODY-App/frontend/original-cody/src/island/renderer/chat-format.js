'use strict';
(()=>{
 const tags='ANSWER|SUMMARY|NEXT_ACTIONS|DONE_TITLE|ARTIFACTS|ROUTINE|COMPUTER_USE_REQUEST|WAIT_FOR|LEARNED';
 const fenceLine=/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
 const languageNames=new Map(Object.entries({html:'HTML',xml:'XML',css:'CSS',js:'JavaScript',javascript:'JavaScript',ts:'TypeScript',typescript:'TypeScript',py:'Python',python:'Python',json:'JSON',yaml:'YAML',yml:'YAML',sql:'SQL',sh:'Shell',bash:'Bash',ps1:'PowerShell',powershell:'PowerShell',cs:'C#',csharp:'C#',cpp:'C++',md:'Markdown',markdown:'Markdown',text:'Plain text',plaintext:'Plain text'}));
 function closingFence(line,marker){
  const match=fenceLine.exec(line);
  return match&&match[1][0]===marker[0]&&match[1].length>=marker.length&&!match[2].trim();
 }
 function splitFences(lines){
  const chunks=[];
  let marker=null,start=0;
  for(let index=0;index<lines.length;index++){
   if(marker){
    if(closingFence(lines[index],marker)){
     chunks.push({lines:lines.slice(start,index+1),code:true,closed:true});
     start=index+1;marker=null;
    }
   }else{
    const opening=fenceLine.exec(lines[index]);
    if(!opening)continue;
    if(index>start)chunks.push({lines:lines.slice(start,index),code:false});
    start=index;marker=opening[1];
   }
  }
  if(start<lines.length)chunks.push({lines:lines.slice(start),code:Boolean(marker),closed:false});
  return chunks;
 }
 const value=input=>typeof input==='string'||typeof input==='number'?String(input):'';
 const array=input=>Array.isArray(input)?input:[];
 function answerText(answer){
  if(!answer||typeof answer!=='object')return value(answer);
  const lines=[],lead=value(answer.outcome)||value(answer.line);
  if(lead)lines.push(lead,'');
  for(const item of array(answer.numbers).filter(Boolean))lines.push('- '+[value(item.label),value(item.value)].filter(Boolean).join(': ')+(item.of?' of '+value(item.of):'')+(item.was?' (was '+value(item.was)+')':''));
  if(array(answer.numbers).length)lines.push('');
  for(const [index,item] of array(answer.list).filter(Boolean).entries())lines.push((answer.ranked?`${index+1}. `:'- ')+value(item.text)+(item.detail?' — '+value(item.detail):''));
  for(const item of array(answer.done).filter(Boolean))lines.push('- '+value(item.did)+(item.what?' — '+value(item.what):''));
  if(answer.draft?.text)lines.push('',...value(answer.draft.text).split('\n').map(line=>'> '+line));
  for(const item of array(answer.ask).filter(Boolean))lines.push('- '+[value(item.answer)||value(item.file),value(item.detail)].filter(Boolean).join(' — '));
  if(answer.note)lines.push('',value(answer.note));
  if(answer.next?.label)lines.push('',value(answer.next.label));
  return lines.join('\n').trim();
 }
 function normalize(text){
  // Code samples are literal, including examples of the reply protocol.
  return splitFences(String(text??'').replace(/\r\n?/g,'\n').split('\n')).map(chunk=>{
   let part=chunk.lines.join('\n');
   if(chunk.code)return part;
   let summary='';
   part=part.replace(new RegExp('<\\s*('+tags+')\\s*>([\\s\\S]*?)<\\s*\\/\\s*\\1\\s*>','gi'),(_match,tag,body)=>{
    switch(tag.toUpperCase()){
     case 'ANSWER':try{return '\n'+answerText(JSON.parse(body.trim()))+'\n';}catch{return body.trim();}
     case 'SUMMARY':summary=body.trim();return '';
     case 'NEXT_ACTIONS':return body.trim()?'\n\n### Next actions\n'+body.trim()+'\n':'';
     case 'ARTIFACTS':return body.trim()?'\n\n### Files\n'+body.trim()+'\n':'';
     default:return '';
    }
   });
   // Hide partially streamed JSON/metadata blocks and incomplete protocol tags.
   part=part.replace(new RegExp('<\\s*(?:'+tags+')\\s*>[\\s\\S]*$','i'),'');
   part=part.replace(/<\/?[A-Z_]*$/,'');
   return part.trim()?part:summary;
  }).join('\n').trim();
 }
 function inline(node,text,depth=0){
  if(depth>6){node.append(document.createTextNode(text));return;}
  const token=/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;let position=0,match;
  while((match=token.exec(text))){
   node.append(document.createTextNode(text.slice(position,match.index)));const raw=match[0];let child;
   if(raw[0]==='`'){child=document.createElement('code');child.textContent=raw.slice(1,-1);}
   else if(raw[0]==='['){const link=/^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw);let url;try{url=new URL(link[2]);}catch{}
    if(url&&['http:','https:'].includes(url.protocol)){child=document.createElement('a');child.href=url.href;child.target='_blank';child.rel='noopener noreferrer';inline(child,link[1],depth+1);}else child=document.createTextNode(link[1]);
   }else{const strong=raw.startsWith('**')||raw.startsWith('__');child=document.createElement(strong?'strong':'em');inline(child,raw.slice(strong?2:1,strong?-2:-1),depth+1);}
   node.append(child);position=match.index+raw.length;
  }
  node.append(document.createTextNode(text.slice(position)));
 }
 function codeBlock(language,source){
  const block=document.createElement('div'),toolbar=document.createElement('div'),label=document.createElement('span');
  const button=document.createElement('button'),pre=document.createElement('pre'),code=document.createElement('code');
  block.className='chat-code';toolbar.className='chat-code-toolbar';
  label.textContent=languageNames.get(language)||language||'Code';
  button.type='button';button.textContent='Copy';button.setAttribute('aria-label','Copy '+label.textContent+' code');
  button.addEventListener('click',async()=>{
   try{
    if(window.cody?.copyCode)await window.cody.copyCode(source);
    else await navigator.clipboard.writeText(source);
    button.textContent='Copied';
   }catch{button.textContent='Copy failed';}
  });
  code.dataset.language=language;code.textContent=source;
  pre.append(code);toolbar.append(label,button);block.append(toolbar,pre);
  return block;
 }
 function render(node,text,role='assistant',mention=null){
  node.replaceChildren();
  if(role==='user'){
   const content=String(text??'');
   if(mention && typeof mention.id==='string' && typeof mention.name==='string' &&
      Number.isInteger(mention.offset) && mention.offset>=0 && mention.offset<=content.length &&
      window.CODYInlineComposer?.badge){
    node.append(document.createTextNode(content.slice(0,mention.offset)),
      window.CODYInlineComposer.badge(mention),document.createTextNode(content.slice(mention.offset)));
   }else node.textContent=content;
   return;
  }
  const chunks=splitFences(normalize(text).split('\n')),fragment=document.createDocumentFragment();let paragraph=null,list=null,quote=null;
  const reset=()=>{paragraph=null;list=null;quote=null;};
  const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim());
  for(const chunk of chunks){
   reset();
   if(chunk.code){
    const language=fenceLine.exec(chunk.lines[0])[2].trim().split(/\s+/)[0].toLowerCase();
    fragment.append(codeBlock(language,chunk.lines.slice(1,chunk.closed?-1:undefined).join('\n')));
    continue;
   }
   const lines=chunk.lines;
   for(let index=0;index<lines.length;index++){
   const line=lines[index];
   if(/^\s*(?:<!doctype\s+html\b|<(?:html|head|body|main|div|script|style|p|h[1-6])(?:[ \t>]))/i.test(line)){
    reset();
    let end=lines.length-1;
    while(end>index&&!/>\s*$/.test(lines[end]))end--;
    fragment.append(codeBlock('html',lines.slice(index,end+1).join('\n')));
    index=end;continue;
   }
   if(!line.trim()){reset();continue;}
   if(line.includes('|')&&index+1<lines.length&&/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index+1])){
    reset();const wrapper=document.createElement('div'),table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody');wrapper.className='chat-table';
    const row=(text,tag)=>{const tr=document.createElement('tr');for(const cell of cells(text)){const td=document.createElement(tag);inline(td,cell);tr.append(td);}return tr;};
    head.append(row(line,'th'));index+=2;while(index<lines.length&&lines[index].trim()&&lines[index].includes('|')){body.append(row(lines[index],'td'));index++;}index--;table.append(head,body);wrapper.append(table);fragment.append(wrapper);continue;
   }
   const heading=/^\s*(#{1,6})\s+(.+)$/.exec(line),item=/^\s*(?:([-*•])|(\d+)[.)])\s+(.+)$/.exec(line),quoted=/^\s*>\s?(.*)$/.exec(line);
   if(heading){reset();const h=document.createElement('h'+Math.min(heading[1].length+1,6));inline(h,heading[2]);fragment.append(h);}
   else if(item){paragraph=null;quote=null;const type=item[2]?'ol':'ul';if(!list||list.tagName.toLowerCase()!==type){list=document.createElement(type);if(type==='ol')list.start=Number(item[2]);fragment.append(list);}const li=document.createElement('li');inline(li,item[3]);list.append(li);}
   else if(quoted){paragraph=null;list=null;if(!quote){quote=document.createElement('blockquote');fragment.append(quote);}const p=document.createElement('p');inline(p,quoted[1]);quote.append(p);}
   else{list=null;quote=null;if(!paragraph){paragraph=document.createElement('p');fragment.append(paragraph);}else paragraph.append(document.createElement('br'));inline(paragraph,line);}
   }
  }
  node.replaceChildren(fragment);
 }
 const api=Object.freeze({normalize,answerText,render});
 if(typeof module!=='undefined')module.exports=api;
 if(typeof window!=='undefined')window.CODYChatFormat=api;
})();
