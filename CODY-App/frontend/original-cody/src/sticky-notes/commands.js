'use strict';
const {commandText}=require('../command-text');
const NOTE=String.raw`(?:sticky[ -]?note|post[ -]?(?:it|et|at)(?:[ -]?note)?)`;
function parseNoteCommand(input){
  const text=commandText(input,{preserveShow:true,imperativeOnly:true}).replace(/[.!?]+$/,'').trim()
    .replace(/^i(?: want| need| would like|'d like) (?:(?:you to|to have) )?/i,'').replace(/^just /i,'');
  const create=new RegExp(String.raw`^(?:(?:give|make|create|add|open|put|leave|show)(?: me)? )?(?:a |an |the |another )?(?:new )?(?:(blank|empty) )?${NOTE}(?: (blank|empty))?(.*)$`,'i').exec(text);
  if(!create)return null;
  const tail=create[3].trim();
  const position=/\b(?:top|bottom)[ -]?(?:left|right)(?:[ -]?(?:hand|corner))?\b/i.exec(tail)?.[0]?.toLowerCase().replace(/[^a-z]/g,'')||'';
  const placement=position.startsWith('bottom')?'bottom': 'top';
  const side=position.includes('left')?'left':'right';
  const content=/^(?:saying|that says|with (?:the )?text|reading)\s+([\s\S]+)$/i.exec(tail);
  const placementTail=tail.replace(/^(?:that |which )?(?:i can|to) (?:type|write)(?: in| on| into)?(?: and (?:move|drag)(?: around)?(?: (?:the |my )?screen)?)?$/i,'').replace(/^(?:on (?:the |my )?(?:screen|desktop))$/i,'');
  const onlyPlacement=/^(?:(?:in|on|at|to) (?:the |my )?(?:top|bottom)[ -]?(?:left|right)(?:[ -]?(?:hand|corner))?(?: corner)?)?(?: (?:for me|please))?$/i.test(placementTail);
  // Requests to research or draft information continue through the assistant.
  if(!content&&!onlyPlacement)return null;
  if((create[1]||create[2])&&content)return null;
  const originalContent=content&&/\b(?:saying|that says|with (?:the )?text|reading)\s+([\s\S]+)$/i.exec(String(input));
  let body=originalContent?.[1].trim()||content?.[1]||'';
  if(/^(["“])[\s\S]*["”]$/.test(body))body=body.slice(1,-1);
  return {action:'sticky-note.create',args:{text:body,position:placement+'-'+side}};
}
function parseDrawingScope(input){
  const text=commandText(input,{preserveShow:true,imperativeOnly:true}).toLowerCase();
  if(!/\b(?:this|that|the|my|these|those|current|existing|last) (?:drawing|drawings|annotation|annotations|diagram|card)\b/.test(text))return null;
  if(/^(?:keep|show|pin|make|put|let|have)\b/.test(text)&&/\b(?:all (?:my )?apps|across (?:all |other )?apps|every app|any app|all screens|any screen|every screen|all windows|everywhere|when i (?:switch|change|swap) apps)\b/.test(text))
    return {action:'drawing.scope',args:{global:true}};
  if(/^(?:keep|show|bind|attach|limit|only show|unpin)\b/.test(text)&&/\b(?:original|current|this|that|its|same) (?:app|window)\b/.test(text))
    return {action:'drawing.scope',args:{global:false}};
  return null;
}
module.exports={parseNoteCommand,parseDrawingScope};
