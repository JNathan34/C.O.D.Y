'use strict';
// Summarise oversized Firefox DOM observations without hiding the actionable
// links a web automation task needs. Source elements come from the real add-on.
// The output is *observation data*, never executable instructions.
const MAX_RESULT_CHARS=9500;
function compactBrowserObservation(action,response,maxChars=MAX_RESULT_CHARS){
 const full={data:response?.data||{},pageState:response?.pageState||null};
 const encoded=JSON.stringify(full);
 if(encoded.length<=maxChars)return full;
 if(action==='browser.getDom'&&Array.isArray(full.data?.dom?.elements)){
  const original=full.data.dom.elements;
  const url=String(full.pageState?.url||'');
  const videoSite=/youtube\.com|youtu\.be/.test(url);
  // Preserve links likely to carry the user to the chosen video, rather than
  // consuming the complete limit on YouTube's navigation bar and buttons.
  const priority=videoSite?original.filter(e=>/\/watch(?:\?|$)|youtu\.be\//i.test(String(e.href||''))):[];
  const highlighted=original.filter(e=>/\b(?:search|play|pause|video|next|submit)\b/i.test([e.text,e.ariaLabel,e.placeholder].join(' ')));
  const indexes=new Set();const chosen=[];
  const add=e=>{if(!e||indexes.has(e.index))return;indexes.add(e.index);chosen.push(e);};
  priority.forEach(add);highlighted.slice(0,24).forEach(add);original.slice(0,24).forEach(add);
  // Use a size budget instead of fixed element count; no fabricated links.
  const selected=[];
  for(const e of chosen){
   const candidate={data:{dom:{elements:[...selected,e],headings:(full.data.dom.headings||[]).slice(0,12),textLength:full.data.dom.textLength,originalElementCount:original.length,observationTruncated:true}},pageState:full.pageState,
    hint:'These are real visible page elements, prioritised for the requested task. For additional controls use browser.getDom with a narrow selector, such as a[href*=watch] on YouTube.'};
   if(JSON.stringify(candidate).length>maxChars)break;
   selected.push(e);
  }
  return {data:{dom:{elements:selected,headings:(full.data.dom.headings||[]).slice(0,12),textLength:full.data.dom.textLength,originalElementCount:original.length,observationTruncated:true}},
   pageState:full.pageState,
   hint:'This is a bounded selection of actual visible page elements. Use browser.getDom with a specific selector to inspect more; do not guess targets.'};
 }
 // For unstructured text, give bounded head/tail and a request to scope reads.
 const half=Math.max(0,Math.floor((maxChars-450)/2));
 return {truncated:true,excerptStart:encoded.slice(0,half),excerptEnd:encoded.slice(-half),
  pageState:full.pageState,hint:'Page response exceeded the size budget. Request a narrower DOM selector; text was not fully observed.'};
}
module.exports={compactBrowserObservation,MAX_RESULT_CHARS};
