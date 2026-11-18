'use strict';

const localMentions = [
  {id:'tool:weather', name:'Weather', description:'Check the current weather here or in a named city.', icon:'cloud-sun', actions:['weather']},
  {id:'tool:timer', name:'Timer', description:'Start, check or cancel a timer.', icon:'clock', actions:['timer']},
  {id:'tool:calculator', name:'Calculator', description:'Calculate numbers and percentages.', icon:'calculator', actions:['maths']},
  {id:'tool:settings', name:'Settings', description:'Find, open or change C.O.D.Y. settings.', icon:'settings', actions:['app-settings.open','app-settings.change']}
].map(item=>({...item,kind:'tool'}));

function localMentionRoute(id, text, utilities) {
  const capability = localMentions.find(item=>item.id===id);
  if (!capability) return null;
  const route = utilities?.match(text);
  if (!route || !capability.actions.includes(route.action))
    return {error:`${capability.name} can’t handle that request. ${capability.description}`};
  return {route};
}

module.exports = {localMentions,localMentionRoute};
