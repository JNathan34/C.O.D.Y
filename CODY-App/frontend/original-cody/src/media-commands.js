'use strict';
const {commandText}=require('./command-text');
const numbers={a:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,fifteen:15,twenty:20,thirty:30,sixty:60};
function isPlexSessionRequest(input){
  const text=commandText(input).toLowerCase().replace(/ (?:right now|now|at the moment)$/,'');
  if(/^(?:(?:show|check|list) (?:my |our |the )?)?(?:(?:active |current )?plex (?:playback )?(?:viewers|sessions)|(?:active |current )?(?:viewers|sessions) (?:on )?(?:my |our |the )?plex)$/.test(text))return true;
  if(/^are there any (?:active |current )?plex (?:viewers|sessions)$/.test(text))return true;
  const watching=text.replace(/ (?:(?:anything |something )?on |(?:anything |something )?in )?(?:my |our |the )?plex(?: server)?$/,'');
  if(watching===text)return false;
  return /^(?:(?:show|check|see|find out) )?(?:who(?:'?s|se| is)?|how many (?:people|viewers)(?: are)?|(?:is|are) (?:anyone|anybody|someone|people)|(?:if |whether )(?:anyone|anybody|someone) is|(?:my |our )?viewers) (?:currently )?(?:watching|playing)$/.test(watching)||
    /^(?:show|check) (?:my |our |the )?(?:viewers|watching|playing)$/.test(watching);
}
function isOverseerrRequestList(input,connected){
  const text=commandText(input).toLowerCase().replace(/\bmost recent\b/g,'latest');
  if(/^what(?:'s| has) been requested (?:on|in) overseerr(?: recently)?$/.test(text))return true;
  const phrase=text.replace(/^(?:(?:show|check|list|view|pull up)(?: me)?|what (?:are|were)) /,'').replace(/^(?:my|our|the) /,'');
  const requests=phrase.replace(/^((?:recent|latest|newest) )?overseerr /,'$1')
    .replace(/ (?:on|in|from|for) (?:my |our |the )?overseerr(?: plugin| server)?$/,'');
  if(requests!==phrase)return /^(?:(?:recent|latest|newest) )?(?:media )?requests$/.test(requests);
  return Boolean(connected)&&/^(?:(?:recent|latest|newest) (?:media )?requests|media requests)$/.test(requests);
}
function parsePlexAvailability(input){
  const text=commandText(input);
  const match=/^(?:(?:check|see|find out) (?:if|whether) (.+?) is|(?:is|check|do we have) (.+?)) (?:already |currently )?(?:available )?(?:on|in) (?:my |our |the )?(?:plex(?: (?:server|library))?|overseerr)$/i.exec(text);
  if(!match)return null;
  let title=(match[1]||match[2]).trim(),year='';
  const latest=/^(?:the )?(?:latest|newest|most recent) /i.test(title);
  if(latest)title=title.replace(/^(?:the )?(?:latest|newest|most recent) /i,'');
  const qualifier=/^["“]/.test(title)?null:/ (movie|film|tv show|tv series|series|show)$/i.exec(title);
  const type=/^tv /i.test(qualifier?.[1]||'')?'tv':latest?(qualifier&&/show|series/i.test(qualifier[1])?'tv':'movie'):null;
  const shorter=qualifier?title.slice(0,qualifier.index).trim():'';
  if(latest&&shorter)title=shorter;
  title=title.replace(/^["“]|["”]$/g,'').replace(/\s+\(?(\d{4})\)?$/,(_,value)=>{year=value;return '';}).trim();
  if(title.length<2||title.length>100||/^(?:anything|something|everyone|anyone|people)$/i.test(title))return null;
  const searchName=value=>value.replace(/\bspider[ -]?man\b/gi,'Spider-Man');
  return {query:searchName(title),latest,type,year,...(!latest&&shorter.length>=2?{fallbackQuery:searchName(shorter)}:{})};
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
module.exports={parseMediaCommand,parsePlexAvailability,isPlexSessionRequest,isOverseerrRequestList};
