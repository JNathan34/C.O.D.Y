'use strict';

// Runs in an isolated world in the dedicated WhatsApp Web window. It returns
// only what the sender needs to verify the requested conversation and outcome.
function whatsappPage(action,args){
  if(location.origin!=='https://web.whatsapp.com')return null;
  const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  const messageText=value=>String(value||'').replace(/\r\n?/g,'\n');
  const visible=node=>Boolean(node?.getClientRects().length&&getComputedStyle(node).visibility==='visible');
  const shown=(root,selector)=>[...(root?.querySelectorAll(selector)||[])].filter(visible);
  const one=items=>items.length===1?items[0]:null;
  const button=node=>node?.closest('button,[role="button"]');
  const txt=node=>node?.innerText??node?.textContent??'';
  const main=document.querySelector('#main');
  const newChat=()=>one([...new Set(shown(document,'[aria-label="New chat" i],[title="New chat" i],[data-icon="new-chat-outline"],[data-icon="new-chat"]').map(button).filter(visible))]);
  const search=()=>one(shown(document,'input,[contenteditable="true"][role="textbox"],[role="searchbox"]').filter(node=>{
    const labels=['aria-label','placeholder','aria-placeholder','data-placeholder'].map(attribute=>normalize(node.getAttribute(attribute)));
    return labels.some(label=>/^search (?:for )?(?:a )?(?:contacts?|(?:name|contact name) or (?:phone )?number)$/.test(label))||
      (labels.includes('search')&&Boolean(pane(node)));
  }));
  const searchValue=node=>node?.value??txt(node);
  function pane(field){
    let node=field?.parentElement;
    while(node&&node!==document.body&&!node.contains(main)){
      if(shown(node,'h1,h2,h3,[role="heading"],span').some(label=>!label.childElementCount&&normalize(txt(label))==='new chat'))return node;
      node=node.parentElement;
    }
    return null;
  }
  function setText(node,value){
    node.focus();
    if(document.activeElement!==node)return false;
    if(node.tagName==='INPUT')node.select();
    else{
      const range=document.createRange();range.selectNodeContents(node);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    }
    return document.execCommand(value?'insertText':'delete',false,value);
  }
  function candidates(){
    const field=search(),root=pane(field);
    if(!root||normalize(searchValue(field))!==normalize(args.query))return null;
    const lists=shown(root,'[role="list"],[role="grid"],[role="table"],[data-testid="contact-list"]');
    const labels=shown(root,'[role="listitem"] span[title],[role="row"] span[title],[data-testid="cell-frame-container"] span[title],[data-testid="cell-frame-title"]');
    const results=new Map();
    let incomplete=Boolean(shown(root,'[aria-busy="true"],[role="progressbar"]').length);
    for(const list of lists){
      const total=Number(list.getAttribute('aria-rowcount')||0);
      if(total>shown(list,'[role="row"]').length)incomplete=true;
    }
    for(const nameNode of labels){
      const row=nameNode.closest('[data-testid="cell-frame-container"],[role="row"],[role="listitem"]');
      if(!row||results.has(row))continue;
      const name=(nameNode.getAttribute('title')||txt(nameNode)).trim();
      if(!name||['new group','new contact','new community'].includes(normalize(name)))continue;
      for(let parent=row.parentElement;parent&&root.contains(parent);parent=parent.parentElement){
        if(parent.scrollHeight>parent.clientHeight+2&&/auto|scroll/.test(getComputedStyle(parent).overflowY))incomplete=true;
      }
      const exactNumber=value=>/^\+[\d ().-]+$/.test(value)&&value.replace(/\D/g,'')===args.phone;
      const matches=args.phone?(exactNumber(name)||shown(row,'span').some(part=>!part.childElementCount&&exactNumber(txt(part).trim()))):normalize(name)===normalize(args.query);
      results.set(row,{name,node:nameNode,matches});
    }
    return {incomplete,matches:[...results.values()].filter(item=>item.matches)};
  }
  function title(){
    const header=main?.querySelector('header');
    const node=shown(header,'[data-testid="conversation-info-header-chat-title"],span[title]')[0];
    return node?.getAttribute('title')||txt(node);
  }
  const isTarget=()=>Boolean(main&&normalize(title())===normalize(args.name)&&args.name&&!search());
  const compose=()=>one(shown(main,'footer [contenteditable="true"]:is([role="textbox"],[data-lexical-editor="true"],[aria-label="Type a message" i])'));
  const outgoing=()=>shown(main,'.message-out[data-id],.message-out [data-id],[data-id^="true_"]').filter(node=>node.hasAttribute('data-id'));

  if(action==='status')return {ready:Boolean(document.querySelector('#pane-side')||newChat()||pane(search())||main?.querySelector('header')),
    login:shown(document,'canvas[aria-label], [data-ref], [data-testid="qrcode"], [data-icon="qr-code"]').length>0};
  if(action==='new-chat'){
    if(pane(search()))return true;
    const control=newChat();if(!control)return false;control.click();return true;
  }
  if(action==='search-ready')return Boolean(pane(search()));
  if(action==='query'){
    const field=search();if(!pane(field))return false;
    return setText(field,args.query)&&normalize(searchValue(field))===normalize(args.query);
  }
  if(action==='matches'||action==='choose'){
    const result=candidates();if(!result)return null;
    const {incomplete,matches}=result;
    if(action==='matches')return {incomplete,count:matches.length};
    if(incomplete||matches.length!==1)return null;
    matches[0].node.click();return {name:matches[0].name};
  }
  if(action==='composer')return isTarget()&&Boolean(compose());
  if(action==='fill'){
    if(!isTarget())return {status:'changed'};
    const box=compose();if(!box||messageText(txt(box)).trim())return {status:'existing-draft'};
    const seen=[...new Set(outgoing().map(node=>node.getAttribute('data-id')))];
    return {status:setText(box,args.text)?'filled':'unavailable',seen};
  }
  if(action==='send'){
    const box=compose();
    if(!isTarget()||!box||messageText(txt(box))!==args.text)return false;
    const footer=box.closest('footer');
    const send=one([...new Set(shown(footer,'[aria-label="Send" i],[title="Send" i],[data-icon="send"]').map(button).filter(visible))]);
    if(!send||send.disabled||send.getAttribute('aria-disabled')==='true')return false;
    send.click();return true;
  }
  if(action==='clear-draft'){
    const box=compose();
    if(!isTarget()||!box||messageText(txt(box))!==args.text)return false;
    return setText(box,'');
  }
  if(action==='receipt'){
    if(!isTarget())return null;
    for(const row of outgoing().reverse()){
      if(args.seen.includes(row.getAttribute('data-id')))continue;
      const bubble=row.closest('.message-out')||row;
      const body=shown(bubble,'.selectable-text.copyable-text,[data-testid="msg-text"]');
      if(!body.some(node=>messageText(txt(node))===args.text))continue;
      const sent=shown(bubble,'[data-icon="msg-check"],[data-icon="msg-dblcheck"],[data-icon="msg-dblcheck-ack"],[data-testid="msg-check"],[data-testid="msg-dblcheck"],[aria-label="Sent" i],[aria-label="Delivered" i],[aria-label="Read" i]').length>0;
      return {sent};
    }
  }
  return null;
}

function whatsappScript(action,args={}){
  return `(${whatsappPage.toString()})(${JSON.stringify(action)},${JSON.stringify(args)})`;
}

module.exports={whatsappScript};
