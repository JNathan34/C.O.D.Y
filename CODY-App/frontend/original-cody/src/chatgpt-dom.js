'use strict';
/**
 * ChatGPT browser UI compatibility layer. DOM is not an API; fail closed if the
 * page no longer presents the verified composer/menu/response controls.
 * Selectors were checked against miuuyy/codex-chatgpt-web v6.1.14 (MIT).
 */
const CHATGPT_URL='https://chatgpt.com/';
const COMPOSER='[data-testid="prompt-textarea"], #prompt-textarea, [contenteditable="true"][data-lexical-editor="true"], form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]';
const SEND='[data-testid="send-button"], button[type="submit"]';
const STOP='[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"]';
const ASSISTANTS='[data-testid^="conversation-turn-"][data-turn="assistant"], [data-testid^="conversation-turn-"][data-message-author-role="assistant"], [data-testid^="conversation-turn-"]:has([data-message-author-role="assistant"]), [data-turn-key]:has([data-conversation-role="assistant"], [data-chatgpt-agent-turn-start]), [data-message-author-role="assistant"]';
const USERS='[data-testid^="conversation-turn-"][data-turn="user"], [data-testid^="conversation-turn-"][data-message-author-role="user"], [data-testid^="conversation-turn-"]:has([data-message-author-role="user"]), [data-turn-key]:has([data-user-message-bubble]), [data-message-author-role="user"]';
const MODEL_TRIGGER='button[aria-haspopup="menu"][data-tone="neutral"], button[data-testid="model-switcher-dropdown-button"][aria-haspopup="menu"], button[data-codex-intelligence-trigger="true"][data-composer-navigation-target="reasoning"][aria-haspopup="menu"]';
const approvedHosts=new Set(['chatgpt.com','auth.openai.com','auth0.openai.com','login.openai.com','accounts.openai.com','accounts.google.com','login.microsoftonline.com','appleid.apple.com','idmsa.apple.com']);
function approvedUrl(url){try{const u=new URL(url);return u.protocol==='https:'&&approvedHosts.has(u.hostname);}catch{return false;}}
function safeChatUrl(url){try{const u=new URL(url);return u.origin==='https://chatgpt.com'&&/^\/c\/[0-9a-f-]{10,80}\/?$/i.test(u.pathname)?u.href:null;}catch{return null;}}
function snapshotScript(){return `(() => {
  const selector=${JSON.stringify(COMPOSER)};
  const composer=Array.from(document.querySelectorAll(selector)).find(e=>e.getClientRects().length>0) || document.querySelector(selector);
  // Turn-key ancestors can nest the role nodes; count the outermost conversation turns only.
  const collect=(selector)=>{const found=Array.from(document.querySelectorAll(selector));const unique=[];for(const node of found){
    const root=node.closest('[data-testid^="conversation-turn-"], [data-turn-key]')||node;
    if(!unique.some(x=>x===root||x.contains(root)))unique.push(root);
  }return unique;};
  const assistants=collect(${JSON.stringify(ASSISTANTS)});
  const users=collect(${JSON.stringify(USERS)});
  const last=assistants.at(-1);
  const lastAssistantKey=last?.getAttribute?.('data-turn-key')||last?.getAttribute?.('data-testid')||null;
  const lastUser=users.at(-1);
  const lastUserKey=lastUser?.getAttribute?.('data-turn-key')||lastUser?.getAttribute?.('data-testid')||null;
  const userBody=lastUser?.querySelector?.('.whitespace-pre-wrap')||lastUser?.querySelector?.('[data-message-author-role="user"], [data-user-message-bubble]')||lastUser;
  const lastUserText=String(userBody?.innerText||userBody?.textContent||'').trim().slice(0,30000);
  const lastUserImageCount=Array.from(lastUser?.querySelectorAll?.('img')||[]).filter(node=>!node.closest?.('[data-testid*="avatar"],[class*="avatar"]')&&/blob:|data:image|estuary|attachment|uploaded/i.test(String(node.src||'')+' '+String(node.alt||''))).length;
  // Only read assistant-authored answer nodes, NEVER the entire turn wrapper.
  // That wrapper may contain accessible labels such as "ChatGPT said:", activity,
  // navigation, loading states, or commentary before a real response arrives.
  const answerSelector='.markdown, [data-markdown-text-style="assistant-message"], .puik-root.not-markdown > [class*="_DilResponseRoot"]';
  const answerUnits=last ? Array.from(last.querySelectorAll('[data-content-search-unit-key]')).filter(e=>e.querySelector('[data-conversation-role="assistant"]')) : [];
  const scopes=answerUnits.length ? answerUnits : last?[last]:[];
  const roots=[];
  for(const scope of scopes){
    const candidates=Array.from(scope.querySelectorAll(answerSelector));
    for(const e of candidates){
      if(e.closest('[data-streaming-response-status], [data-testid^="cot-v5"]'))continue;
      if(e.closest('[data-chatgpt-agent-turn-start]'))continue;
      if(e.parentElement?.closest(answerSelector))continue;
      if(e.getAttribute('aria-hidden')==='true')continue;
      if(!roots.includes(e))roots.push(e);
    }
  }
  // Old UI uses a role-owned assistant node. Its text is usable only if no
  // structured root exists AND it is the assistant body itself (never a group).
  const fallback=last?.matches?.('[data-message-author-role="assistant"]') ? last :
    last?.querySelector?.('[data-message-author-role="assistant"]');
  let answer=roots.map(e=>e.innerText||e.textContent||'').filter(Boolean).join('\\n').trim();
  if(!answer && !roots.length && fallback && !last?.hasAttribute?.('data-turn-key'))
    answer=(fallback.innerText||'').trim();
  // A common accessible role label must not be mistaken for an answer.
  if(/^(?:ChatGPT|Assistant) said\\s*:?$/i.test(answer))answer='';
  const answerPresent=Boolean(answer);
  // Counts and IDs can change when history hydrates or gets virtualised.
  // Bind the answer body to the latest user body by real document order.
  const answerBody=roots[0]||fallback;
  const order=answerBody?(userBody?.compareDocumentPosition?.(answerBody)||0):0;
  const answerAfterUser=Boolean(lastUser&&answerBody&&(order&4)&&!(order&25));
  const text=(document.body?.innerText||'').slice(0,5000);
  const authRequired=!composer && (['/auth/', '/login', '/signin', '/sign-in'].some(p=>location.pathname.toLowerCase().startsWith(p))
    || !!document.querySelector('input[type="password"], a[href*="login"], a[href*="auth.openai.com"]')
    || /log in|sign up|sign in|continue with google/i.test(text));
  const challenge=!composer && /just a moment|verify you are human|checking your browser|security check|cloudflare/i.test(text);
  const form=composer?.closest('form');const senders=form?Array.from(form.querySelectorAll(${JSON.stringify(SEND)})):[];
  return {ready:!!composer,userCount:users.length,assistantCount:assistants.length,lastUserText,lastUserKey,lastAssistantKey,lastUserImageCount,
    answer:answer.slice(0,180000),answerPresent,answerAfterUser,generating:!!document.querySelector(${JSON.stringify(STOP)}),
    composerText:(composer?.innerText||composer?.value||'').trim().slice(0,250),
    sendCount:senders.length,sendEnabled:senders.length===1&&!senders[0].disabled,
    authRequired,challenge,pageLoaded:document.readyState==='complete',
    title:(document.title||'').slice(0,120),url:location.href};
})()`;}
// Clear any unsent draft before placing CODY's fully prepared prompt.
// We clear only the active composer, NOT the entire page or another input.
function clearComposerScript(){return `(() => {
  const editor=Array.from(document.querySelectorAll(${JSON.stringify(COMPOSER)})).find(e=>e.getClientRects().length>0);
  if(!editor)return {ok:false,why:'ChatGPT composer was not found for clearing.'};
  editor.focus();
  if(editor.isContentEditable){
    const selection=window.getSelection(),range=document.createRange();
    range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
    document.execCommand('delete',false);
    editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
  }else{
    const proto=Object.getPrototypeOf(editor),descriptor=Object.getOwnPropertyDescriptor(proto,'value');
    if(descriptor?.set)descriptor.set.call(editor,'');else editor.value='';
    editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
  }
  return {ok:true};
})()`;}
function emptyComposerScript(){return `(() => {
  const editor=Array.from(document.querySelectorAll(${JSON.stringify(COMPOSER)})).find(e=>e.getClientRects().length>0);
  if(!editor)return {ok:false,why:'ChatGPT composer disappeared after clearing.'};
  const text=editor.isContentEditable?(editor.textContent||''):(editor.value||'');
  const cleared=String(text).replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g,'').trim().length===0;
  return {ok:cleared,why:cleared?'':'ChatGPT has not cleared the previous draft. C.O.D.Y will not append to it.'};
})()`;}
function composeScript(text){return `(() => {
  const editor=Array.from(document.querySelectorAll(${JSON.stringify(COMPOSER)})).find(e=>e.getClientRects().length>0);
  if(!editor)return {ok:false,why:'ChatGPT composer not found. Check ChatGPT sign-in.'};
  editor.focus();
  if(editor.isContentEditable){
    const sel=window.getSelection(),range=document.createRange();range.selectNodeContents(editor);sel.removeAllRanges();sel.addRange(range);
    if(!document.execCommand('insertText',false,${JSON.stringify(text)}))return {ok:false,why:'ChatGPT rejected inserted text.'};
    editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(text)}}));
  }else{
    const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor),'value');
    if(descriptor?.set)descriptor.set.call(editor,${JSON.stringify(text)});else editor.value=${JSON.stringify(text)};
    editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(text)}}));
  }
  // React/Lexical may update the composer asynchronously. The caller must await
  // verifyComposerScript before pressing Send, rather than comparing innerText here.
  return {ok:true,textLength:${JSON.stringify(text.length)}};
})()`;}
/**
 * Validate the rendered rich-text composer, not innerText alone. The original
 * codex-chatgpt-web v6.1.14 extracts top-level text nodes from a clone; this
 * avoids Chromium adding artificial blank lines between Lexical paragraphs.
 * A second whitespace-normalised comparison only tolerates rendering whitespace
 * changes. It never ignores changed, missing or additional non-space characters.
 */
function verifyComposerScript(text){return `(() => {
  const expected=${JSON.stringify(text)};
  const editor=Array.from(document.querySelectorAll(${JSON.stringify(COMPOSER)})).find(e=>e.getClientRects().length>0);
  if(!editor)return {ok:false,why:'ChatGPT composer disappeared before sending.'};
  const plain=editor.isContentEditable?null:String(editor.value||'');
  let structured='';
  if(editor.isContentEditable){
    const clone=editor.cloneNode(true);
    clone.querySelectorAll('svg, style, script, [data-id^="plugin:"][data-keyword], [data-inline-selection-pill-cursor-target], [app-mention-path^="app://"][app-mention-display-name][contenteditable="false"]').forEach(part=>part.remove());
    structured=Array.from(clone.childNodes).map(n=>n.textContent||'').join('\\n').trimStart();
  }
  const visible=editor.isContentEditable?String(editor.innerText||''):plain;
  const canonical=s=>String(s||'').replace(/\\r\\n?/g,'\\n').replace(/\\u00a0/g,' ').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g,'').replace(/\\s+/g,' ').trim();
  const exact=s=>String(s||'').replace(/\\r\\n?/g,'\\n')===expected.replace(/\\r\\n?/g,'\\n');
  const ok=[structured,visible,plain].filter(x=>x!==null).some(x=>exact(x)||canonical(x)===canonical(expected));
  const observed=structured||visible;
  return {ok,textLength:observed.length,expectedLength:expected.length,
    why:ok?'':'ChatGPT composer verification failed (expected '+expected.length+' characters, observed '+observed.length+'). No message was sent.'};
})()`;}
function sendScript(){return `(() => {
  const editor=Array.from(document.querySelectorAll(${JSON.stringify(COMPOSER)})).find(e=>e.getClientRects().length>0);
  const form=editor?.closest('form');
  if(!form)return {ok:false,why:'ChatGPT composer form not found (website layout changed).'};
  const buttons=Array.from(form.querySelectorAll(${JSON.stringify(SEND)})).filter(e=>e.getClientRects().length>0);
  if(buttons.length!==1)return {ok:false,why:'Expected one visible submit button inside ChatGPT composer, found '+buttons.length+'.'};
  const btn=buttons[0];if(btn.disabled||btn.getAttribute('aria-disabled')==='true')return {ok:false,why:'ChatGPT send button is disabled.'};
  btn.click();return {ok:true};
})()`;}
// The effort/model trigger can appear beside the Send arrow, in the composer form.
function openModelMenuScript(){return `(() => {
  const composer=Array.from(document.querySelectorAll(${JSON.stringify(COMPOSER)})).find(e=>e.getClientRects().length>0);
  const form=composer?.closest('form');if(!form)return {ok:false,why:'ChatGPT composer form missing'};
  let buttons=Array.from(form.querySelectorAll(${JSON.stringify(MODEL_TRIGGER)})).filter(e=>e.getClientRects().length>0);
  if(buttons.length===0){
    // Newer ChatGPT layouts expose '5.6 Instant' or '6 Medium' without aria-haspopup.
    // Restrict discovery to the same composer to avoid clicking unrelated UI.
    buttons=Array.from(form.querySelectorAll('button,[role="button"]')).filter(e=>e.getClientRects().length>0 && /^(?:GPT[-\\s]*)?(?:5\\.6|6(?:\\.1)?)(?:\\s+Sol)?\\s+(?:Instant|Medium|High|Extra High)$/i.test((e.innerText||e.textContent||'').trim().replace(/\\s+/g,' ')));
  }
  if(buttons.length!==1)return {ok:false,why:'Model picker unavailable or ambiguous ('+buttons.length+' controls). Choose Web: current to use the visible ChatGPT model.'};
  const button=buttons[0];if(button.getAttribute('aria-expanded')!=='true')button.click();
  return {ok:true,label:(button.innerText||button.textContent||'').trim().slice(0,100)};
})()`;}
// Read only model selectors belonging to the visible chat composer. A clearly
// labelled current model is enough to avoid reopening an often-hidden picker.
function currentModelLabelScript(){return `(() => {
  const composer=Array.from(document.querySelectorAll(${JSON.stringify(COMPOSER)})).find(e=>e.getClientRects().length>0);
  const form=composer?.closest('form');
  if(!form)return {ok:false,why:'Composer form not ready'};
  const visible=e=>e.getClientRects().length>0 && (!window.getComputedStyle || getComputedStyle(e).visibility!=='hidden');
  const candidates=Array.from(form.querySelectorAll('button,[role="button"]')).filter(visible).map(e=>({
    name:(e.getAttribute('aria-label')||e.innerText||e.textContent||'').trim().replace(/\\s+/g,' '),
    text:(e.innerText||e.textContent||'').trim().replace(/\\s+/g,' '),
    isTrigger:e.matches?.(${JSON.stringify(MODEL_TRIGGER)})||false
  }));
  const known=candidates.filter(c=>/^(?:(?:GPT[-\\s]*)?(?:5\\.6|6(?:\\.1)?)(?:\\s+Sol)?\\s+(?:Instant|Medium|High|Extra High)|(?:GPT[-\\s]*)?6\\s+Extra High)$/i.test(c.name)||/^(?:(?:GPT[-\\s]*)?(?:5\\.6|6(?:\\.1)?)(?:\\s+Sol)?\\s+(?:Instant|Medium|High|Extra High)|(?:GPT[-\\s]*)?6\\s+Extra High)$/i.test(c.text));
  if(known.length!==1)return {ok:false,why:'Current model not visibly identifiable',count:known.length};
  const pattern=/^(?:GPT[-\\s]*)?(?:5\\.6|6(?:\\.1)?)(?:\\s+Sol)?\\s+(?:Instant|Medium|High|Extra High)$/i;
  return {ok:true,label:pattern.test(known[0].text)?known[0].text:known[0].name};
})()`;}
function modelFamilyMatches(family,label){
 const value=String(label||'').trim();
 if(family==='6.1-sol')return /^(?:GPT[-\s]*)?6\.1\s+Sol(?:\s+Pro)?$/i.test(value);
 return family==='6'?/^(?:latest|(?:gpt[-\s]*)?6(?:\s+(?:Astra|Sol))?(?:\s+Pro)?)$/i.test(value):/^(?:gpt[-\s]*)?5\.6\s+Sol(?:\s+Pro)?$/i.test(value);
}
function currentModelMatches(preference,label){
 const m=/^(6|6\.1-sol|5\.6):(low|medium|high|xhigh)$/.exec(String(preference||''));if(!m)return false;
 const found=/^(?:GPT[-\s]*)?(6\.1|6|5\.6)(?:\s+(Sol|Astra))?\s+(Instant|Medium|High|Extra High)$/i.exec(String(label||'').replace(/\s+/g,' ').trim());
 if(!found||(m[1]==='6.1-sol'?found[1]!=='6.1'||found[2]?.toLowerCase()!=='sol':found[1]!==m[1]))return false;
 return ({instant:'low',medium:'medium',high:'high','extra high':'xhigh'})[found[3].toLowerCase()]===m[2];
}
function modelMenuSnapshotScript(){return `(() => {
  const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  const sliders=Array.from(document.querySelectorAll('[data-model-reasoning-effort-slider] [role="slider"], [data-model-picker-power-slider] [role="slider"]')).filter(e=>visible(e.closest('[data-model-reasoning-effort-slider], [data-model-picker-power-slider]')));
  const slider=sliders.length===1?sliders[0]:null;
  const menu=slider?.closest('[role="menu"]')||Array.from(document.querySelectorAll('[role="menu"], [data-testid="composer-intelligence-picker-content"]')).find(e=>visible(e)&&e.querySelector('[role="menuitemradio"]'));
  const radios=menu?Array.from(menu.querySelectorAll('[role="menuitemradio"]')).map(e=>({name:(e.getAttribute('aria-label')||e.innerText||e.textContent||'').trim(),checked:e.getAttribute('aria-checked')==='true',visible:visible(e)})):[];
  const container=slider?.closest('[data-model-reasoning-effort-slider], [data-model-picker-power-slider]');
  const locks=container?Array.from(container.querySelectorAll('[data-selected]')).map(x=>x.getAttribute('data-locked')):[];
  const composer=Array.from(document.querySelectorAll(${JSON.stringify(COMPOSER)})).find(e=>visible(e));
  const trigger=composer?.closest('form')?.querySelector(${JSON.stringify(MODEL_TRIGGER)});
  return {menuOpen:Boolean(menu&&visible(menu)),radios,slider:slider?{min:Number(slider.getAttribute('aria-valuemin')),max:Number(slider.getAttribute('aria-valuemax')),value:Number(slider.getAttribute('aria-valuenow')),locks}:null,label:(trigger?.innerText||trigger?.textContent||'').trim().slice(0,120)};
})()`;}
function expandModelFamilyScript(){return `(() => {
  const view=Array.from(document.querySelectorAll('[data-model-picker-view]')).find(e=>e.getClientRects().length>0);
  if(view?.getAttribute('data-model-picker-view')==='simple'){
    const toggles=Array.from(view.querySelectorAll('[data-model-picker-view-toggle="true"]')).filter(e=>e.getClientRects().length>0);
    if(toggles.length!==1)return {ok:false,why:'Advanced model view ambiguous'};
    toggles[0].click();return {ok:true};}
  const row=Array.from(document.querySelectorAll('[role="menuitem"][aria-expanded="false"]')).find(e=>e.getClientRects().length>0);
  if(row){row.click();return {ok:true};}
  return {ok:false,why:'Advanced model menu not present'};
})()`;}
function chooseModelFamilyScript(family){return `(() => {
  const radios=Array.from(document.querySelectorAll('[role="menuitemradio"]')).filter(e=>e.getClientRects().length>0);
  const matches=radios.filter(e=>${family==='6.1-sol'?String.raw`/^(?:GPT[-\s]*)?6\.1\s+Sol(?:\s+Pro)?$/i`:family==='5.6'?String.raw`/^(GPT[-\s]?)?5\.6\s+Sol(?:\s+Pro)?$/i` : String.raw`/^(?:Latest|(?:GPT[-\s]?)?6(?:\s+Astra)?(?:\s+Pro)?)$/i`}.test((e.getAttribute('aria-label')||e.innerText||e.textContent||'').trim()));
  if(matches.length!==1)return {ok:false,why:'Requested model family not available ('+matches.length+' matches).'};
  if(matches[0].getAttribute('aria-checked')!=='true')matches[0].click();
  return {ok:true,selected:matches[0].getAttribute('aria-checked')==='true'};
})()`;}
function focusEffortSliderScript(){return `(() => {
  const containers=Array.from(document.querySelectorAll('[data-model-reasoning-effort-slider], [data-model-picker-power-slider]')).filter(e=>e.getClientRects().length>0);
  if(containers.length!==1)return {ok:false,why:'Expected one visible model effort control'};
  const sliders=containers[0].querySelectorAll('[role="slider"]');if(sliders.length!==1)return {ok:false,why:'Expected one effort slider'};
  const slider=sliders[0],min=Number(slider.getAttribute('aria-valuemin')),max=Number(slider.getAttribute('aria-valuemax'));
  if(!Number.isInteger(min)||!Number.isInteger(max)||max-min>4)return {ok:false,why:'Unknown model slider range'};
  slider.focus();return {ok:true,min,max};
})()`;}
function cleanErrorMessage(message){return String(message||'Unknown browser error').slice(0,500);}
function diffResponse(last,next){return String(last||'')===String(next||'')?null:String(next||'');}
module.exports={CHATGPT_URL,COMPOSER,SEND,ASSISTANTS,USERS,MODEL_TRIGGER,approvedUrl,safeChatUrl,snapshotScript,clearComposerScript,emptyComposerScript,composeScript,verifyComposerScript,sendScript,openModelMenuScript,currentModelLabelScript,currentModelMatches,modelMenuSnapshotScript,expandModelFamilyScript,chooseModelFamilyScript,focusEffortSliderScript,cleanErrorMessage,diffResponse};

module.exports.modelFamilyMatches=modelFamilyMatches;
