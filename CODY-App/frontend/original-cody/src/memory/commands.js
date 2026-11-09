'use strict';

const SHARED_PAUSED='Claude through HeyClicky is paused while Local memory only is on. Local commands still work.';

function localMemoryText(input,localOnly){
  const match=/^(?:please\s+)?remember\s+([\s\S]+)$/i.exec(String(input||'').trim());
  if(!match)return null;
  const explicit=/^locally(?:\s+|$)/i;
  if(!localOnly&&!explicit.test(match[1]))return null;
  return match[1].replace(explicit,'').replace(/^that(?:\s+|$)/i,'').trim();
}

module.exports={localMemoryText,SHARED_PAUSED};
