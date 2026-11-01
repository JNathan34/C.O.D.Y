'use strict';
const {isIP}=require('node:net');
// Keep browser-tool validation in the trusted Electron main process.
const str=(value,max,name)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('Invalid '+name);return value;};
const selector=value=>value===undefined?undefined:str(value,300,'selector');
function safeUrl(value){
 let u;try{u=new URL(str(value,2048,'URL'));}catch{throw Error('Invalid URL');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Only HTTP(S) URLs without embedded credentials are allowed');
 const h=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
 if(isIP(h)===6||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||h==='0.0.0.0'||h==='::1'||h==='127.0.0.1'||/^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h))throw Error('Local/private network URLs are not allowed by CODY browser tools');
 return u.toString();
}
function validateBrowserArgs(action,args){
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Invalid browser arguments');
 switch(action){
 case 'browser.readText':return {selector:args.selector===undefined?'body':selector(args.selector),maxChars:Number.isInteger(args.maxChars)?Math.max(100,Math.min(12000,args.maxChars)):9000};
 case 'browser.readComments':return {limit:Number.isInteger(args.limit)?Math.max(1,Math.min(10,args.limit)):5};
 case 'browser.navigate':return {url:safeUrl(args.url)};
 case 'browser.pageInfo':case 'browser.listTabs':case 'browser.closeTab':return {};
 case 'browser.getDom':return {simplified:args.simplified!==false,selector:selector(args.selector)};
 case 'browser.newTab':return args.url===undefined?{}:{url:safeUrl(args.url)};
 case 'browser.switchTab':if(!Number.isSafeInteger(args.tabId)||args.tabId<1)throw Error('Invalid tab ID');return {tabId:args.tabId};
 case 'browser.click':case 'browser.hover':{
  const result={};if(args.selector!==undefined)result.selector=selector(args.selector);
  if(args.text!==undefined)result.text=str(args.text,200,'target text');
  if(Number.isFinite(args.x)&&Number.isFinite(args.y)&&Math.abs(args.x)<50000&&Math.abs(args.y)<50000){result.x=args.x;result.y=args.y;}
  if(!result.selector&&!result.text&&result.x===undefined)throw Error('Specify selector, visible text, or valid coordinates');
  if(action==='browser.click'){
   result.button=['left','right','middle'].includes(args.button)?args.button:'left';
   result.clickCount=args.clickCount===2?2:1;
  }
  return result;
 }
 case 'browser.type':return {text:str(args.text,2048,'text'),selector:selector(args.selector),clear:args.clear===true,pressEnter:args.pressEnter===true};
 case 'browser.scroll':if(!['up','down','left','right'].includes(args.direction))throw Error('Invalid scroll direction');return {direction:args.direction,amount:Number.isFinite(args.amount)?Math.max(1,Math.min(2500,args.amount)):500,selector:selector(args.selector)};
 case 'browser.keypress':{
  const key=str(args.key,30,'key');if(!/^[\w ]{1,30}$/.test(key))throw Error('Invalid key');
  const modifiers=Array.isArray(args.modifiers)?args.modifiers:[];
  if(modifiers.length>4||!modifiers.every(x=>['ctrl','alt','shift','meta'].includes(x)))throw Error('Invalid key modifiers');return {key,modifiers};
 }
 case 'browser.select':return {selector:str(args.selector,300,'selector'),...(args.value!==undefined?{value:str(args.value,200,'option value')}:{text:str(args.text,200,'option text')})};
 case 'browser.wait':{
  if(args.selector===undefined&&args.text===undefined&&args.ms===undefined)throw Error('Specify a wait condition');
  return {selector:selector(args.selector),text:args.text===undefined?undefined:str(args.text,200,'wait text'),ms:Math.max(0,Math.min(5000,Number(args.ms)||0)),timeout:Math.max(1000,Math.min(12000,Number(args.timeout)||10000))};
 }
 default:throw Error('Unsupported browser action');
 }
}
module.exports={validateBrowserArgs,safeUrl};
