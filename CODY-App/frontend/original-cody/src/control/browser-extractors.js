"use strict";
// Fixed, reviewed read-only DOM extraction. Model and page text cannot specify
// JavaScript code. The bridge calls the Firefox extension's execute_js transport
// with one of these application-defined scripts; no eval or network operations here.
const escapeJS = value => JSON.stringify(value);
function readTextExpression({selector='body',maxChars=9000}={}) {
  const sel=escapeJS(selector),limit=Math.min(Math.max(Number(maxChars)||9000,1),12000);
  return `(() => {
    const query=${sel};const limit=${limit};
    const root=document.querySelector(query);
    if(!root)return {found:false,selector:query,url:location.href,text:'',reason:'Selector not present; perhaps scroll or wait for content'};
    const text=String(root.innerText||root.textContent||'').replace(/\\u00a0/g,' ').trim();
    return {found:true,selector:query,url:location.href,text:text.slice(0,limit),truncated:text.length>limit,length:text.length};
  })()`;
}
function readCommentsExpression({limit=5}={}) {
  const n=Math.min(Math.max(Number(limit)||5,1),10);
  return `(() => {
    const limit=${n};const url=new URL(location.href);
    if(!/(^|\\.)youtube\\.com$/.test(url.hostname)||!url.pathname.startsWith('/watch')) {
      return {supported:false,url:location.href,comments:[],error:'Open a YouTube watch page first'};
    }
    const roots=[...document.querySelectorAll('ytd-comment-thread-renderer')];
    const nodes=roots.length?roots:[...document.querySelectorAll('ytd-comment-view-model')];
    const cleaned=s=>String(s||'').replace(/\\s+/g,' ').trim();
    const text=(node,query)=>{const e=node.querySelector(query);return e?cleaned(e.innerText||e.textContent):''};
    const comments=[];
    for(const node of nodes){
      if(comments.length>=limit)break;
      const body=text(node,'#content-text, yt-attributed-string#content-text, [id="content-text"]');
      if(!body)continue;
      const author=text(node,'#author-text, [id="author-text"], #header-author a');
      const likes=text(node,'#vote-count-middle, [id="vote-count-middle"], .like-count');
      comments.push({position:comments.length+1,author:author.slice(0,130)||null,text:body.slice(0,1800),displayedLikes:likes||null});
    }
    const sortLabel=[...document.querySelectorAll('ytd-comments-header-renderer, #sort-menu')].map(e=>cleaned(e.innerText||'')).find(Boolean)||null;
    return {supported:true,url:location.href,comments,requested:limit,returned:comments.length,displayedOrderOnly:true,sortLabel:sortLabel?.slice(0,160)||null,notes:comments.length<limit?'Some comments may not have loaded. Scroll near comments, wait, then repeat this read. Null likes means the count could not be read; never assume zero.':'These are the first comments displayed by YouTube in its current sort order; do not invent missing like counts.'};
  })()`;
}
module.exports={readTextExpression,readCommentsExpression};
