'use strict';
const GPT_MODEL='gpt-6.1-sol',GPT_EFFORT='medium';
const PROVIDERS=Object.freeze({heyclicky:'Claude Code',codex:'ChatGPT Codex',chatgpt:'ChatGPT'});
function selection(settings={}){const provider=Object.hasOwn(PROVIDERS,settings.assistantProvider)?settings.assistantProvider:'heyclicky';return {provider,label:PROVIDERS[provider],model:provider==='heyclicky'?null:GPT_MODEL,effort:provider==='heyclicky'?null:GPT_EFFORT};}
function providerPatch(provider){if(!Object.hasOwn(PROVIDERS,provider))throw Error('Choose Claude Code, ChatGPT Codex or ChatGPT.');return {assistantProvider:provider,...(provider==='heyclicky'?{}:{model:GPT_MODEL,defaultReasoning:GPT_EFFORT,webModel:'6.1-sol:medium'})};}
function exactCodexModel(models){const selected=models.find(m=>!m.hidden&&(m.model===GPT_MODEL||m.id===GPT_MODEL));if(!selected)throw Error('GPT 6.1 Sol is unavailable for this Codex account. No different model was selected.');const efforts=(selected.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort);if(efforts.length&&!efforts.includes(GPT_EFFORT))throw Error('This account does not offer Medium reasoning for GPT 6.1 Sol.');return {model:GPT_MODEL,effort:GPT_EFFORT};}
module.exports={GPT_MODEL,GPT_EFFORT,PROVIDERS,selection,providerPatch,exactCodexModel};
