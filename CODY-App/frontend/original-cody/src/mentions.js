'use strict';
const {parseWordCommand,parseWordInsertion}=require('./control/word-edit');
const {WHATSAPP_DRAFTS_PLUGIN}=require('./integrations/whatsapp-drafts');
const {PLEX_PLUGIN_ID}=require('./media-commands');

const localMentions = [
  {id:'tool:weather', name:'Weather', description:'Check the current weather here or in a named city.', icon:'cloud-sun', actions:['weather']},
  {id:'tool:timer', name:'Timer', description:'Start, check or cancel a timer.', icon:'clock', actions:['timer']},
  {id:'tool:calculator', name:'Calculator', description:'Calculate numbers and percentages.', icon:'calculator', actions:['maths']},
  {id:'tool:settings', name:'Settings', description:'Find, open or change C.O.D.Y. settings.', icon:'settings', actions:['app-settings.open','app-settings.change']}
].map(item=>({...item,kind:'tool'}));
localMentions.push({id:'plugin:word',name:'Word (Desktop)',description:'Draft and format the Word document open on this PC, or insert attached pictures. Built into C.O.D.Y.',icon:'file-text',kind:'plugin',actions:['word.edit']});
localMentions.push({id:WHATSAPP_DRAFTS_PLUGIN,name:'WhatsApp',description:'Draft a WhatsApp message for review. Try “Message Mum saying what’s for dinner?”',icon:'whatsapp',kind:'plugin',actions:['whatsapp-draft']});
localMentions.push({id:PLEX_PLUGIN_ID,name:'Plex',description:'Check who is watching on your connected Plex server. Try “Who’s watching?”',icon:'play',kind:'plugin',actions:['self-hosted-plex-sessions']});

function localMentionRoute(id, text, utilities) {
  const capability = localMentions.find(item=>item.id===id);
  if (!capability) return null;
  const route = id==='plugin:word'
    ? parseWordCommand(text) || parseWordInsertion(text)
    : utilities?.match(text,{capabilityId:id});
  if (!route || !capability.actions.includes(route.action))
    return {error:`${capability.name} can’t handle that request. ${capability.description}`};
  return {route};
}

module.exports = {localMentions,localMentionRoute};
