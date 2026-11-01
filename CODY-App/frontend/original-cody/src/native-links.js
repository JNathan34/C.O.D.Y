'use strict';
function nativeLink(value){if(typeof value!=='string'||value.length>25000)return null;try{const url=new URL(value);return ['cody:','heyclicky:','clicky:'].includes(url.protocol)&&Boolean(url.hostname)?value.replace(/^clicky:/i,'heyclicky:'):null;}catch{return null;}}
function linksFromArgs(args){return Array.isArray(args)?args.map(nativeLink).filter(Boolean):[];}
module.exports={nativeLink,linksFromArgs};
