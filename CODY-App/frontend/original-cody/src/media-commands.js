'use strict';
const {commandText}=require('./command-text');
const numbers={a:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,fifteen:15,twenty:20,thirty:30,sixty:60};
const PLEX_PLUGIN_ID='plugin:plex';
const plexName='(?:plex|pleks?|plecks?|plax|plezy|plezzy|plexy)';
const mediaService=`(?:${plexName}(?: (?:media server|server|library|plug[ -]?in))?|overseerr?(?: (?:server|plug[ -]?in))?|media library)`;
const plexMentions=new RegExp(`\\b${plexName}\\b`,'g');
const serviceLocation=new RegExp(`\\b(?:on|in|through|via|using|with|to) (?:my |our |the )?${mediaService}\\b`,'i');
const serviceSubject=new RegExp(`^(?:(?:does|did|has|is|search|check|ask|use|find) )?(?:my |our |the )?${mediaService}[,:]? (?:(?:currently|still|already) )?(?:has|have|add|added|carry|carries|offer|offers|for) (.+)$`,'i');
const serviceIntro=new RegExp(`^(?:my |our |the )?${mediaService}(?:[,:] +| to (?:see|check) (?:if|whether) )`,'i');
const barePlexQuestion=new RegExp(`^((?:is|are) .+?) (${plexName}(?: (?:server|library))?)$`,'i');
const requestLead=/^(?:check|confirm|verify|see|find out|look up|look for|search(?: for)?|find)(?: me)?(?: (?:if|whether|that|to see (?:if|whether)))?\s+/i;
const titleLeads=[
  /^(?:(?:where )?(?:can|could|may) (?:i|we)|are we able to) (?:watch|stream|find|play|get|see) /i,
  /^(?:do|did|have) (?:i|we|you|they)(?: (?:still|currently|already))? (?:have|got|add|added) /i,
  /^(?:it|the server|the library) (?:has added|has|contains) /i,
  /^what(?:'s| is) (?=(?:the )?(?:latest|newest|most recent|new) )/i,
  /^(?:is there|are there|is|are|has|have|request) /i
];
const availabilityTail=/(?: (?:is|are|was|were|has been|have been|been|get|got))? (?:already |currently |recently |still |now )?(?:available(?: to (?:watch|stream))?|added|listed|streaming|downloaded)$/i;
const trailingTime=/(?:[, ]+(?:right now|at the moment|today|already|currently|now|yet|by any chance|for streaming|to watch|to stream))+$/i;
const additionalAction=/\b(?:and (?:then |also )?|also )(?:open|close|launch|play|pause|show|check|find|request|tell|send|turn|switch)\b/i;
const maskQuotedTitles=text=>text.replace(/"[^"]*"|“[^”]*”/g,value=>' '.repeat(value.length));

function mediaText(input,{spoken=false}={}){
  let text=commandText(input);
  // A spoken service name can be joined to its preposition.
  text=text.replace(/\b(?:onplex|om ?plex|inplex)\b(?=(?:[, ]+(?:right now|at the moment|today|already|now|yet|for streaming|to watch|to stream))*$)/i,'on Plex');
  if(spoken)text=text.replace(/\b(?:on|in) (?:my |our |the )?flex\b(?=(?: (?:server|library|right now|yet))*$)/i,'on Plex');
  return text;
}
const subjects='(?:viewers|sessions|streams|activity|now playing)';
const plexActivity=new RegExp(`^(?:(?:show|check|list|refresh|are there any|any) (?:my |our |the )?)?(?:(?:active |current )?plex (?:playback )?${subjects}|(?:active |current )?${subjects} (?:on |in |from )?(?:my |our |the )?plex)(?: server)?$`);
const plexCommand=(value,spoken)=>mediaText(value,{spoken}).toLowerCase().replace(trailingTime,'')
  .replace(plexMentions,'plex');
function isPlexSessionRequest(input,{spoken=false,plexContext=false,selected=false}={}){
  const command=plexCommand(input,spoken);
  const pluginPrefix=/^(?:use|ask) (?:the |my |our )?plex(?: plug[ -]?in)? to /.exec(command);
  const text=pluginPrefix?command.slice(pluginPrefix[0].length):command;
  if(plexActivity.test(text))return true;
  if(/^(?:(?:check|use) (?:the )?plex plug[ -]?in|(?:the )?plex plug[ -]?in|check (?:my |our |the )?plex(?: server)?)$/.test(text))return true;
  const watching=text.replace(/ (?:(?:anything |something )?(?:on|in|using|via|with) )?(?:my |our |the )?plex(?: server| plug[ -]?in)?$/,'');
  const explicit=watching!==text||Boolean(pluginPrefix);
  const viewerQuestion=/\b(?:who(?:'?s|se)?|anyone|anybody|someone|viewers)\b|^(?:what|which)\b.*\b(?:people|they|others)\b|^(?:what|which) (?:movie|film|show|episode|title) (?:is|are) (?:playing|streaming)\b/.test(text);
  const playback=/\b(?:watching|viewing|streaming|playing)\b/.test(text);
  const activityQuery=/^(?:how many|are there|show|check|list|any)\b.*\b(?:active|current|live) (?:viewers|sessions|streams)\b/.test(text);
  if((selected||plexContext||/\bplex\b/.test(text))&&(viewerQuestion&&playback||activityQuery)&&
     !/^(?:explain|why|when|how (?:can|does|do)|help)\b/.test(text)&&!additionalAction.test(text))return true;
  if(!explicit&&!selected&&!plexContext)return false;
  if(spoken&&plexContext&&/^is (?:washing|watching) collect$/.test(text))return true;
  if((selected||plexContext)&&/^(?:check|refresh|check again|any viewers|viewers|sessions|activity|what about now|now playing)$/.test(text))return true;
  return /^(?:(?:show|check|see|find out) )?(?:who(?:'?s|se| is)?|what(?:'?s| is)|how many (?:people|viewers|streams)(?: are)?|(?:is|are) (?:anyone|anybody|someone|people)|(?:if |whether )(?:anyone|anybody|someone) is|(?:my |our )?viewers|anyone|anybody) (?:currently )?(?:watching|playing|streaming)$/.test(watching)||
    /^(?:(?:show|check|list) (?:my |our |the )?)?(?:viewers|watching|playing)$/.test(watching)||
    explicit&&/^(?:(?:is )?(?:anyone|anybody|someone)|who(?:'?s| is))$/.test(watching);
}
function hasRecentPlexRequest(messages,now=Date.now()){
  const recent=(messages||[]).filter(message=>message?.role==='user'&&
    (!message.at||Math.abs(now-Date.parse(message.at))<=5*60*1000)).slice(-2);
  const explicit=message=>Boolean(message&&(message.mention?.id===PLEX_PLUGIN_ID||isPlexSessionRequest(message.text)));
  return explicit(recent.at(-1))||Boolean(explicit(recent.at(-2))&&isPlexSessionRequest(recent.at(-1)?.text,{spoken:true,plexContext:true}));
}
function isOverseerrRequestList(input,connected){
  const text=commandText(input,{preserveShow:true}).toLowerCase().replace(/\bmost recent\b/g,'latest');
  if(/^check (?:my |our |the )?overseerr?(?: plugin| server)?$/.test(text))return true;
  if(/^what(?:'s| has) been requested (?:on|in) overseerr?(?: recently)?$/.test(text))return true;
  const phrase=text.replace(/^(?:(?:show|check|list|view|pull up)(?: me)?|what (?:are|were)|are there|do (?:i|we) have) /,'')
    .replace(/^(?:my|our|the|any) /,'');
  const requests=phrase.replace(/^((?:recent|latest|newest) )?overseerr? /,'$1')
    .replace(/ (?:on|in|from|for) (?:my |our |the )?overseerr?(?: plugin| server)?$/,'');
  if(requests!==phrase&&/^(?:(?:recent|latest|newest) )?(?:media )?requests$/.test(requests))return true;
  if(Boolean(connected)&&/^(?:(?:recent|latest|newest) (?:media )?requests|media requests)$/.test(requests))return true;
  if(!/^(?:what|which|show|check|list|view|pull up|are there|do (?:i|we) have)\b/.test(text)||
     /\b(?:api|endpoint|documentation)\b/.test(text)||additionalAction.test(text))return false;
  return /\boverseerr?\b/.test(text)&&/\b(?:requests|been requested|pending)\b/.test(text)||
    Boolean(connected)&&/\b(?:media|movie|tv) requests\b/.test(text)&&!/\b(?:on|in|from)\b/.test(text);
}
function isPlexRecentRequest(input,{spoken=false}={}){
  const text=plexCommand(input,spoken);
  return /\bplex\b/.test(text)&&!additionalAction.test(text)&&(
    /^what(?:'s| is) new (?:on|in) (?:my |our |the )?plex(?: (?:server|library))?$/.test(text)||
    /^(?:what|which)\b/.test(text)&&/\b(?:been added|recently added|(?:added|got) .*(?:recently|lately)|(?:latest|newest) (?:additions|movies|shows|titles))\b/.test(text)||
    /^(?:(?:show|list|check) )?(?:my |our |the )?plex(?: server)?(?:'s)? (?:recent|latest|newest) (?:additions|movies|shows|titles|media)$/.test(text)||
    /^(?:(?:show|list|check) )?(?:my |our |the )?(?:the )?(?:recent|recently added|latest|new)\b/.test(text)&&/\b(?:movies|shows|titles|media|additions)\b/.test(text)
  );
}

function lookupTitle(text){
  const phrase=text.replace(requestLead,'').replace(/^(?:if|whether) (?=.*\b(?:is|are|has|have|does|did)\b)/i,'');
  const subject=serviceSubject.exec(phrase);
  if(subject)return subject[1];
  const intro=serviceIntro.exec(phrase);
  // Preserve service-like words inside a quoted title.
  const location=serviceLocation.exec(maskQuotedTitles(phrase));
  if(!intro&&!location)return '';
  const before=intro?'':phrase.slice(0,location.index).trim();
  const after=phrase.slice(intro?intro[0].length:location.index+location[0].length).replace(/^[\s,:]+/,'');
  if(before&&after)return '';
  let candidate=before||after.replace(/^for /i,'').replace(requestLead,'');
  const lead=titleLeads.find(pattern=>pattern.test(candidate));
  if(lead)candidate=candidate.replace(lead,'');
  else if(/^(?:who|what|why|when|where|which|how|do|play|watch|stream|resume|pause|stop|skip|open|launch|help|fix|troubleshoot|configure|connect|disconnect|cancel|delete|approve|reject|tell me about|thoughts about|explain)\b/i.test(candidate))return '';
  const title=candidate.replace(availabilityTail,'');
  return lead?title:title.replace(/ (?:is|are|was|were)$/i,'');
}

function availabilityArgs(title){
  let year='';
  if(additionalAction.test(maskQuotedTitles(title)))return null;
  const recency=/^(?:the )?(latest|newest|most recent|new) /i.exec(title);
  const qualifiedTitle=recency?title.slice(recency[0].length):title;
  const qualifier=/^["“]/.test(qualifiedTitle)?null:/ (movie|film|tv show|tv series|series|show)$/i.exec(qualifiedTitle);
  const latest=Boolean(recency&&(recency[1].toLowerCase()!=='new'||qualifier));
  if(latest)title=qualifiedTitle;
  const type=/^tv /i.test(qualifier?.[1]||'')?'tv':latest?(qualifier&&/show|series/i.test(qualifier[1])?'tv':'movie'):null;
  const shorter=qualifier?title.slice(0,qualifier.index).trim():'';
  if(latest&&shorter)title=shorter;
  title=title.replace(/^["“]|["”]$/g,'').replace(/\s+\(?(\d{4})\)?$/,(_,value)=>{year=value;return '';}).trim();
  if(title.length<2||title.length>100||/^(?:anything|something|everyone|anyone|people|it|that|this|the|my|our|your)$/i.test(title))return null;
  const searchName=value=>value.replace(/\bspider[ -]?man\b/gi,'Spider-Man');
  return {query:searchName(title),latest,type,year,...(!latest&&shorter.length>=2?{fallbackQuery:searchName(shorter)}:{})};
}
function parsePlexAvailability(input,{spoken=false,availabilityContext=false}={}){
  let text=mediaText(input,{spoken}).replace(trailingTime,'');
  // Repair service names only in spoken availability questions. "Play" on its own is ambiguous.
  const misheardService=spoken&&/^(?:is|are|has|have|do|can|could|check|see|verify|confirm|find out)\b/i.test(text)&&
    /\b(?:on|in) (?:my |our |the )?(plea|play)$/i.exec(text);
  const repairService=misheardService&&(misheardService[1].toLowerCase()==='plea'||availabilityContext||
    /\b(?:movie|film|tv show|tv series|show|episode)\b/i.test(text));
  if(repairService)text=text.slice(0,misheardService.index)+'on Plex';
  // Speech can collapse "on Plex" into "complex". Limit the repair to spoken new-title lookups.
  if(spoken&&/^is (?:the )?(?:new|latest|newest|most recent) .+ (?:movie|film|tv show|tv series|series|show) complex$/i.test(text))
    text=text.replace(/ complex$/i,' on Plex');
  const bare=barePlexQuestion.exec(text);
  if(bare&&!serviceLocation.test(maskQuotedTitles(text))){
    // Handle the reported transcript "Is the odysseum plex?" at the service boundary.
    text=bare[1].replace(/\bodysseum$/i,'Odyssey')+' on '+bare[2];
  }
  const title=lookupTitle(text).trim();
  const description=/^the (?:movie|film|tv show|tv series|show|episode) (?:(called|named) )?(.+)$/i.exec(title);
  if(description&&(repairService||description[1]||/^(?:the |["“])/i.test(description[2])))return availabilityArgs(description[2]);
  return availabilityArgs(title);
}
function parsePlexAvailabilityFollowUp(input,{spoken=false}={}){
  const text=commandText(input);
  const followUp=/^(?:what about|how about|and) (.+?)(?: too| as well)?$/i.exec(text);
  if(!followUp)return null;
  const title=followUp[1];
  if(/^(?:if|whether|then|can (?:you|we)|open|close|play|pause|send|turn|switch|(?:my|our|your) (?:calendar|email|schedule|account|settings)|(?:the )?(?:weather(?: today| tomorrow)?|time|date)$)\b/i.test(title))return null;
  return parsePlexAvailability('Is '+title,{spoken,availabilityContext:true})||availabilityArgs(title);
}
function hasPlexAvailabilityContext(messages){
  // Only use the previous turn. A different user topic ends the follow-up.
  for(let index=(messages?.length||0)-1;index>=0;index--){
    const message=messages[index];
    if(message?.role==='user')
      return !message.attachments?.length&&!message.mention&&Boolean(parsePlexAvailability(message.text,{spoken:true}));
    if(message?.role==='assistant'&&(message.plexAvailability===true||message.mediaLookup?.result||message.mediaLookup?.choices?.length))
      return true;
  }
  return false;
}
function parseMediaCommand(input){
  // Resolve player names only at the command boundary, preserving movie titles.
  const text=commandText(input).replace(/\b(on|in|using) (?:plex|plezzy|plexy)$/i,'$1 Plezy'),lower=text.toLowerCase();
  if(/^(?:open|launch|start) (?:the |my )?(?:plex|plezy|plezzy|plexy)(?: app| application)?$/.test(lower))return {action:'app.open',args:{app:'plezy'}};
  const transport=/^(play|resume|pause)(?: (?:my |the )?(?:music|movie|video|playback))?(?: (?:(?:on|in|using) )?(plezy|plezzy|plexy|plex))?$/.exec(lower);
  if(transport)return {action:'media.control',args:{command:transport[1]==='pause'?'pause':'play',target:transport[2]?'plezy':'current'}};
  const song=/^(play|resume|pause) (?:my |the |this )?(?:song|track)$/.exec(lower);
  if(song)return {action:'media.control',args:{command:song[1]==='pause'?'pause':'play',target:'current'}};
  if(/^continue (?:my |the )?(?:music|movie|video|playback)$/.test(lower))return {action:'media.control',args:{command:'play',target:'current'}};
  const title=/^(?:play|watch|put on|start|resume|continue) (.+?) (?:on|in|using) plezy$/i.exec(text);
  if(title){const original=title[1].replace(/^["“]|["”]$/g,'').trim();if(original.length&&original.length<=180)return {action:'plezy.play',args:{title:original}};}
  const track=/^(next|previous|skip)(?: (?:the |this )?(track|song|episode))?(?: (?:on|in) (plezy))?$/.exec(lower);
  if(track&&(track[2]||track[3]))return {action:'media.control',args:{command:track[1]==='previous'?'previous':'next',target:track[3]?'plezy':'current'}};
  const seek=/^(skip|jump|go|seek|fast forward|rewind|forward)(?: (forward|ahead|back|backward|backwards))? (\d+(?:\.\d+)?|a|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)(?: (forward|ahead|back|backward|backwards))?(?: (?:on|in) (plezy|plezzy|plexy))?$/.exec(lower);
  if(seek){const amount=numbers[seek[3]]||Number(seek[3]),scale=/^(?:min)/.test(seek[4])?60:/^(?:h)/.test(seek[4])?3600:1;const seconds=amount*scale*(seek[1]==='rewind'||/back/.test((seek[2]||'')+(seek[5]||''))?-1:1);if(Number.isFinite(seconds)&&seconds!==0&&Math.abs(seconds)<=86400)return {action:'media.control',args:{command:'seek',target:seek[6]?'plezy':'current',seconds}};}
  return null;
}
module.exports={PLEX_PLUGIN_ID,parseMediaCommand,parsePlexAvailability,parsePlexAvailabilityFollowUp,hasPlexAvailabilityContext,
  isPlexSessionRequest,hasRecentPlexRequest,isOverseerrRequestList,isPlexRecentRequest};
