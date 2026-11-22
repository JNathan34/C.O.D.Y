'use strict';
const {randomUUID}=require('node:crypto');

const DRAFT_LIFETIME=10*60*1000;
const WHATSAPP_DRAFTS_PLUGIN='plugin:whatsapp-drafts';

function phoneNumber(value){
  if(typeof value!=='string'||!/^\+[1-9][\d ().-]{6,27}$/.test(value.trim()))return null;
  const digits=value.replace(/\D/g,'');
  return /^[1-9]\d{6,14}$/.test(digits)?digits:null;
}

function parseWhatsAppDraft(input,{selected=false}={}){
  const text=String(input||'').trim().replace(/^(?:(?:hey\s+)?c[.\s]*o[.\s]*d[.\s]*y[,.!:]?\s+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?/i,'');
  if(/^tell me\b/i.test(text))return null;
  const match=/^(?:message|text|tell|(?:send|draft) (?:a )?message to)\s+([^\n]{1,90}?)\s+(?:on|using|via)\s+whats\s?app(?:\s+(?:saying|with the message)\b\s*[:;,]?\s*|\s*[:;,]\s*|\s+|$)([\s\S]*)$/i.exec(text)
    ||/^(?:send|draft) (?:a )?whats\s?app message to\s+([^\n]{1,90}?)(?:\s+saying\b\s*[:;,]?\s*|\s*[:;,]\s*|$)([\s\S]*)$/i.exec(text)
    ||(selected&&/^(?:message|text|tell|(?:send|draft) (?:a )?message to)\s+([^\n]{1,90}?)(?:\s+saying\b\s*[:;,]?\s*|\s*[:;,]\s*|$)([\s\S]*)$/i.exec(text));
  if(!match)return null;
  return {recipient:match[1].trim(),text:match[2].trim(),...(/^draft /i.test(text)?{draftOnly:true}:{})};
}

function draftProblem({recipient,text},phone){
  if(!text)return 'What would you like the WhatsApp message to say? Try “Message Mum on WhatsApp saying hello.”';
  if(text.length>3000)return 'Keep the WhatsApp message under 3,000 characters.';
  if(!phone&&/^\+[\d\s().-]*$/.test(recipient))return 'Use the full international number, including its country code, or say the contact’s name.';
  return null;
}

const sendReplies={sent:'Message sent on WhatsApp.',
  'already-sent':'That message was just sent on WhatsApp.',
  'not-linked':'Link your account in Settings → Plugins → WhatsApp, then try again.',
  'window-open':'Close the WhatsApp Web window, then ask Cody again.',
  'not-found':'I couldn’t verify an exact contact in WhatsApp. Try their full display name.',
  ambiguous:'WhatsApp has more than one matching contact. Use a unique name or their full international number.',
  'existing-draft':'There’s already a draft in that WhatsApp chat. Clear it before asking Cody to send.',
  uncertain:'I couldn’t verify whether WhatsApp sent the message. Check the chat before retrying.',
  unverified:'I couldn’t verify the chat and message in WhatsApp. Nothing was sent.',
  busy:'A WhatsApp message is still being checked.',
  disabled:'Hands-free WhatsApp sending is off.',
  unavailable:'I couldn’t use WhatsApp Web. Check the connection under Settings → Plugins → WhatsApp.'};

class WhatsAppDrafts{
  constructor({open,browser,now=Date.now}){
    Object.assign(this,{open,browser,now});
    this.drafts=new Map();
  }
  openApp(){return this.open('https://web.whatsapp.com/');}
  async submit(args,{signal}={}){
    if(args.draftOnly||!this.browser?.enabled())return this.prepare(args);
    const phone=phoneNumber(args.recipient),problem=draftProblem(args,phone);
    if(problem)return {reply:problem,error:true};
    const outcome=await this.browser.send({recipient:args.recipient,phone,text:args.text.replace(/\r\n?/g,'\n')},{signal});
    if(outcome==='cancelled')return {reply:'WhatsApp request stopped.',cancelled:true};
    return {reply:sendReplies[outcome]||sendReplies.unavailable,error:!['sent','already-sent'].includes(outcome)};
  }
  prepare({recipient,text}){
    const phone=phoneNumber(recipient),problem=draftProblem({recipient,text},phone);
    if(problem)return {reply:problem};
    const now=this.now();
    for(const [id,draft] of this.drafts)if(draft.expires<=now)this.drafts.delete(id);
    if(this.drafts.size>=20)this.drafts.delete(this.drafts.keys().next().value);
    const id=randomUUID();
    this.drafts.set(id,{recipient,phone,text,expires:now+DRAFT_LIFETIME,opening:false});
    setTimeout(()=>this.drafts.delete(id),DRAFT_LIFETIME).unref();
    return {reply:phone?'Review the draft before opening it in WhatsApp.':'Review the draft, then pick your contact in WhatsApp.',draftId:id};
  }
  preview(id){
    const draft=this.drafts.get(id);
    if(!draft||draft.expires<=this.now()){this.drafts.delete(id);return null;}
    if(draft.opened)return {opened:true};
    const {recipient,phone,text,opening}=draft;
    return {recipient,phone:phone?'+'+phone:null,text,opening};
  }
  async openDraft(id){
    const preview=this.preview(id);
    if(!preview)throw Error('This WhatsApp draft expired. Ask Cody to prepare a new one.');
    if(preview.opened)throw Error('This draft already opened in WhatsApp.');
    const draft=this.drafts.get(id);
    if(draft.opening)throw Error('This draft is already opening in WhatsApp.');
    draft.opening=true;
    const url=new URL(draft.phone||'','https://wa.me/');
    url.searchParams.set('text',draft.text);
    try{await this.open(url.href);}
    catch{draft.opening=false;throw Error('Could not open WhatsApp. Try again.');}
    if(this.drafts.get(id)===draft)this.drafts.set(id,{opened:true,expires:draft.expires});
    return {opened:true};
  }
}

module.exports={WhatsAppDrafts,parseWhatsAppDraft,WHATSAPP_DRAFTS_PLUGIN};
