'use strict';
(()=>{
 const tags='ANSWER|SUMMARY|NEXT_ACTIONS|DONE_TITLE|ARTIFACTS|ROUTINE|COMPUTER_USE_REQUEST|WAIT_FOR|LEARNED';
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
  return String(text??'').replace(/\r\n?/g,'\n').split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g).map((part,index)=>{
   if(index%2)return part;
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
  }).join('').trim();
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
 function render(node,text,role='assistant'){
  node.replaceChildren();if(role==='user'){node.textContent=String(text??'');return;}
  const lines=normalize(text).split('\n'),fragment=document.createDocumentFragment();let paragraph=null,list=null,quote=null,code=null;
  const reset=()=>{paragraph=null;list=null;quote=null;};
  const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim());
  for(let index=0;index<lines.length;index++){
   const line=lines[index];
   if(/^\s*```/.test(line)){if(code)code=null;else{const pre=document.createElement('pre');code=document.createElement('code');code.dataset.language=line.trim().slice(3).trim();pre.append(code);fragment.append(pre);}reset();continue;}
   if(code){code.textContent+=line+(index<lines.length-1?'\n':'');continue;}
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
  node.replaceChildren(fragment);
 }
 const api=Object.freeze({normalize,answerText,render});
 if(typeof module!=='undefined')module.exports=api;
 if(typeof window!=='undefined')window.CODYChatFormat=api;
})();
