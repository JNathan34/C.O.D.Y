'use strict';
// Only remove conversational wrappers for local command matching. Cloud prompts stay intact.
function commandText(input,{preserveShow=false}={}){
  let text=String(input||'').normalize('NFKC').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
  for(let i=0;i<5;i++){
    const before=text;
    text=text.replace(/^(?:um|uh|erm|er|hey|okay|ok)[,.!]?\s+/i,'')
      .replace(/^(?:c[.\s]*o[.\s]*d[.\s]*y|kodi|codi)[,.!?:]*(?:\s+|$)/i,'')
      .replace(/^(?:(?:can|could|would|will) you|would you mind|do you know|i(?:'d| would) like (?:you to|to know))\s+/i,'')
      .replace(preserveShow?/^(?:please|tell me|give me)\s+/i:/^(?:please|tell me|give me|show me)\s+/i,'').trim();
    if(text===before)break;
  }
  return text.replace(/(?:^|\s+|[,!]\s*)(?:please|thanks|thank you)[.!?]*$/i,'').replace(/[.!?,]+$/,'').trim();
}
function repairSpeechCommand(input){
  const text=String(input||'').replace(/\s+/g,' ').trim(),query=commandText(text).toLowerCase().replace(/'/g,'');
  // User-reported short dictation confusion; never globally replace 'times' or 'but'.
  if(/^(?:(?:but|what) (?:the )?(?:time|times|thyme)|(?:whats|what is) (?:the )?(?:times|thyme))(?: (?:now|right now))?$/.test(query))return "What's the time?";
  if(/^(?:whats|what is) the whether(?: like)?$/.test(query))return "What's the weather?";
  // Exact short dictation error reported by this user; don't rewrite Dolby media commands or ordinary prose.
  if(/^(?:whats|what is) (?:the )?(?:lever|leather|whether|wether) in (?:dolby|derby)$/.test(query))return "What's the weather in Derby?";
  return text;
}
module.exports={commandText,repairSpeechCommand};
