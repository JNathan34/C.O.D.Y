'use strict';
const path=require('node:path');
const {wordIntent,directPlan,requestedPaths,validatePlan}=require('./control/word-document');
const {parseWordCommand,parseWordInsertion}=require('./control/word-edit');
const {isImageAttachment}=require('./attachments');

class WordSession {
  constructor({controller,engine,localMemoryOnly=()=>false,canDraft=()=>true}){
    Object.assign(this,{controller,engine,localMemoryOnly,canDraft});
    this.pending=new Map();
  }
  matches(text,chatId,capabilityId,localRoute){
    if(!this.controller||capabilityId&&capabilityId!=='plugin:word')return false;
    const literal=parseWordInsertion(text)&&/^(?:please\s+)?(?:type\s|(?:insert|write|add)\s+(?:["“]|(?:this|the following)(?:\s+text)?\s*:))/i.test(text.trim());
    if(capabilityId==='plugin:word'&&(parseWordCommand(text)||literal))return false;
    if(localRoute)return false;
    if(directPlan(text))return true;
    return wordIntent(text,capabilityId==='plugin:word',this.pending.has(chatId));
  }
  async run({chatId,text,files=[],signal,onProgress=()=>{}}){
    if(/^\s*(?:cancel|never mind|stop)\s*[.!]?$/i.test(text)){
      this.pending.delete(chatId);
      return {reply:'Word request cancelled.',cancelled:true};
    }
    const direct=directPlan(text,files);
    const previous=direct?null:this.pending.get(chatId);
    if(signal?.aborted)return {cancelled:true,reply:'Word request cancelled.'};
    const snapshot=direct?.steps[0].type==='open'?null:await this.controller.readWord();
    if(/^(?:read|show)(?: me)? (?:(?:the|my|this|current) )?(?:Word )?(?:document|selected text)[.!]?$/i.test(text)){
      const reply=/selected text/i.test(text)?snapshot.context.selectedText:snapshot.context.paragraphs.map(paragraph=>paragraph.text).join('');
      return {reply:reply||'The selected document text is empty.'};
    }
    if(previous&&snapshot&&
      (previous.target.window!==snapshot.target.window||previous.target.fullName!==snapshot.target.fullName||
       previous.target.fingerprint!==snapshot.target.fingerprint||previous.target.start!==snapshot.target.start||
       previous.target.end!==snapshot.target.end)){
      this.pending.delete(chatId);
      throw Error('The Word document changed since the previous request. Send the complete request for the intended document.');
    }
    const request=previous?previous.text+'\nFollow-up from the user\n'+text:text;
    if(request.length>25000)throw Error('Use a shorter document request.');
    const images=[...new Set([...(previous?.files||[]),...requestedPaths(request,files)])].filter(isImageAttachment);
    let plan=direct,note='';
    if(!plan){
      if(!this.canDraft())throw Error('Choose C.O.D.Y.’s built-in AI connection to draft Word content.');
      if(this.localMemoryOnly())throw Error('Enable your conversational AI connection to draft Word content. Direct Word commands are available locally.');
      onProgress('Drafting content for Word…');
      const context={...snapshot.context};
      const references=files.filter(file=>/\.(?:docx?|rtf|odt|pdf|txt|md)$/i.test(file));
      if(references.length){
        if(!this.controller.permissions().filesRead)throw Error("Permission 'filesRead' is disabled");
        const reference=await this.engine.request('attachments-text',{files:references});
        const available=Math.max(0,Math.floor((55000-JSON.stringify(context).length)/2));
        context.reference=String(reference.context||'').slice(0,available);
      }
      const generated=await this.engine.request('word-plan',{
        text:request,context:JSON.stringify(context),
        assets:JSON.stringify(images.map((file,index)=>({index,name:path.basename(file)})))
      });
      if(signal?.aborted)return {cancelled:true,reply:'Word request cancelled.'};
      if(typeof generated.question==='string'&&!generated.steps){
        if(!generated.question.trim()||generated.question.length>1000)throw Error('Word returned an invalid clarification.');
        if(this.pending.size>=30)this.pending.delete(this.pending.keys().next().value);
        this.pending.set(chatId,{text:request,target:snapshot.target,files:images});
        return {reply:generated.question,question:true};
      }
      if(typeof generated.answer==='string'&&!generated.steps){
        this.pending.delete(chatId);
        return {reply:generated.answer.slice(0,16000)};
      }
      plan=generated;
      note=typeof generated.note==='string'?generated.note.slice(0,1000):'';
    }
    const paths=requestedPaths(request,files);
    const allowSave=/\b(?:save|export)\b/i.test(request);
    // Validate model output before asking the controller to apply its own checks.
    validatePlan(plan,{images,paths,allowSave});
    if(signal?.aborted)return {cancelled:true,reply:'Word request cancelled.'};
    onProgress('Applying edits in Word…');
    const result=await this.controller.execute('word.document',{
      plan,target:snapshot?.target,images,paths,allowSave
    },{origin:'chat',signal,humanTask:request});
    if(result.cancelled)return {cancelled:true,reply:'Word edits cancelled.'};
    this.pending.delete(chatId);
    return {reply:`Updated ${result.result.document} using local Word commands.`+(note?' '+note:''),result:result.result};
  }
}
module.exports={WordSession};
