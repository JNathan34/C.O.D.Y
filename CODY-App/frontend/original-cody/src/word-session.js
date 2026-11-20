'use strict';
const path=require('node:path');
const {wordIntent,directPlan,requestedPaths,validatePlan,referenceLayout}=require('./control/word-document');
const {WORD_TARGET,parseWordCommand,parseWordInsertion}=require('./control/word-edit');
const {isImageAttachment}=require('./attachments');
const {commandText}=require('./command-text');

const DraftWithoutTopic=/^(?:put|add|insert) (?:some )?(?:pictures|photos|images) and (?:some )?(?:words|text) (?:in|into) (?:this|the|my) (?:Word )?document(?:[,.]?\s+(?:and )?make it look like a (?:proper|professional) document)?[.!]?$/i;
const TargetPhrase='(?:in|into|inside|to|for)\\s+'+WORD_TARGET;
const WordDestination=new RegExp('(?:^'+TargetPhrase+'\\s*,\\s*|\\s+'+TargetPhrase+'(?=$|[,;]|\\s+(?:about|on|and|then)\\s))','i');
const AboutCody=/^(?:about\s+)?(?:yourself|you|c\.?o\.?d\.?y\.?)$/i;
const Proceed=/^(?:(?:yes|ok|okay)[, ]+)?(?:please )?(?:just )?(?:do (?:it|that)|go ahead)$/i;
const Retry=/^(?:please )?try(?: it)? again$/i;
const DefaultDraft=/^(?:introduce yourself|(?:write|draft|compose|type|add|insert) (?:something|some (?:stuff|text|words)|(?:a |an )?(?:brief |short )?introduction)(?: (?:introducing yourself|about (?:yourself|you|c\.?o\.?d\.?y\.?)))?)$/i;
const TopicRequest=/^(?:tell me (?:more )?about|describe(?: to me)?|explain(?: to me)?|say something about|(?:write|draft|compose)(?: me)? about)\s+(.+)$/i;
const CompoundEdit=/(?:\b(?:and|then)\s+|[,;]\s*)(?:then\s+)?(?:please\s+)?(?:save|export|format|replace|revise|insert|add|bold|underline|delete|move|open|make|use)\b|\b(?:instead of|replace|rewrite|revise|at the end|at the top|heading|page break|attached|bullet points)\b/i;
const Introduction='Hi, I’m C.O.D.Y., a Windows desktop assistant. You can talk to me or type a request. I can help you draft text, explain what’s on your screen, and point out details with drawings.';

function simpleDraft(text,{explicitWord=false}={}){
  const command=commandText(text,{imperativeOnly:true});
  const request=command.replace(WordDestination,' ').replace(/ +/g,' ').trim();
  if(explicitWord&&request===command)return null;
  if(/^(?:write|draft|compose)$/i.test(request))return 'needs-topic';
  if(/^type$/i.test(request))return 'needs-text';
  if(DefaultDraft.test(request))return 'introduction';
  const topic=TopicRequest.exec(request);
  if(topic&&!/^(?:what(?:'s|\s+is|\s+was)\b|the contents?\b)/i.test(topic[1])){
    if(AboutCody.test(topic[1]))return 'introduction';
    return CompoundEdit.test(request)?'plan':'prose';
  }
  // Restrict the prose-only route to requests for new writing. Compound edits,
  // formatting, saving and revisions still use the existing Word planner.
  if(!CompoundEdit.test(request)&&
     /^(?:write|draft|compose|type|add) (?:me )?(?:something|some (?:text|words)|(?:a |an |one |two |three |\d+ )?(?:(?:brief|short|long|detailed) )?(?:sentences?|paragraphs?|introduction|note|report|essay|story|poem|letter|summary|description)) (?:about|on) .+/i.test(request))
    return 'prose';
  return null;
}

class WordSession {
  constructor({controller,engine,localMemoryOnly=()=>false,canDraft=()=>true,readReferenceLayout=referenceLayout}){
    Object.assign(this,{controller,engine,localMemoryOnly,canDraft,readReferenceLayout});
    this.pending=new Map();
  }
  matches(text,chatId,capabilityId,localRoute){
    if(!this.controller||capabilityId&&capabilityId!=='plugin:word')return false;
    if(capabilityId==='plugin:word'&&parseWordCommand(text))return false;
    if(localRoute)return false;
    if(parseWordInsertion(text,{wordSelected:false}))return true;
    if(simpleDraft(text,{explicitWord:true}))return true;
    if(directPlan(text))return true;
    return wordIntent(text,capabilityId==='plugin:word',this.pending.has(chatId));
  }
  followUp(text,messages,currentMessageId){
    if(!this.controller||!Array.isArray(messages))return null;
    const command=commandText(text,{imperativeOnly:true});
    if(!Proceed.test(command)&&!Retry.test(command))return null;
    const currentIndex=currentMessageId?messages.findIndex(message=>message.id===currentMessageId):-1;
    const recent=messages.slice(0,currentIndex<0?messages.length:currentIndex).slice(-8);
    let original=-1;
    for(let index=recent.length-1;index>=0;index--){
      const message=recent[index];
      if(message.role!=='user')continue;
      const priorCommand=commandText(message.text,{imperativeOnly:true});
      if(Proceed.test(priorCommand)||Retry.test(priorCommand))continue;
      original=index;break;
    }
    if(original<0)return null;
    const prior=recent[original];
    if(prior.attachments?.length||prior.mention&&prior.mention.id!=='plugin:word'||
       !['introduction','prose'].includes(simpleDraft(prior.text,{explicitWord:true})))return null;
    const replies=recent.slice(original+1).filter(message=>message.role==='assistant').map(message=>message.text);
    if(replies.some(reply=>/^Updated .+ using local Word commands\./i.test(reply)))
      return {reply:'I already updated the Word document. Tell me what else you’d like me to write or change.'};
    const last=replies.at(-1)||'';
    if(/^(?:Open Microsoft Word and choose a document first|Choose an open Word document|Choose an editable, unprotected Word document|C\.O\.D\.Y\. did not return a complete (?:Word editing plan|draft for Word))\b/i.test(last))
      return {text:prior.text};
    if(replies.some(reply=>/^I didn.t fill that in, that field didn.t look safe to type into\./i.test(reply)||
                            /^C\.O\.D\.Y\.[’']s chat box has focus/i.test(reply)))
      return {text:prior.text,requireEmpty:true};
    return {reply:'Check Word for any text from the earlier attempt, then resend what you want me to write.'};
  }
  ask(chatId,question,text,target,files,kind){
    if(!this.pending.has(chatId)&&this.pending.size>=30)this.pending.delete(this.pending.keys().next().value);
    this.pending.set(chatId,{text,target,files,kind});
    return {reply:question,question:true};
  }
  async run({chatId,text,files=[],signal,wordSelected=false,retry=null,onProgress=()=>{}}){
    if(/^\s*(?:cancel|never mind|stop)\s*[.!]?$/i.test(text)){
      this.pending.delete(chatId);
      return {reply:'Word request cancelled.',cancelled:true};
    }
    if(signal?.aborted)return {cancelled:true,reply:'Word request cancelled.'};
    if(retry?.reply)return {reply:retry.reply};
    if(retry?.text)text=retry.text;
    const literal=parseWordInsertion(text,{wordSelected});
    if(literal){
      if(files.length)throw Error('Remove attached files before typing exact text in Word.');
      onProgress('Inserting text in Word…');
      const result=await this.controller.execute(literal.action,literal.args,{origin:'chat',signal,humanTask:text});
      if(result.cancelled)return {cancelled:true,reply:'Word edits cancelled.'};
      this.pending.delete(chatId);
      return {reply:result.result.message,result:result.result};
    }
    const direct=directPlan(text,files);
    const pending=this.pending.get(chatId);
    const newRequest=wordIntent(text)||simpleDraft(text,{explicitWord:true});
    const previous=direct||pending?.kind==='topic'&&newRequest?null:pending;
    const snapshot=direct?.steps[0].type==='open'?null:await this.controller.readWord();
    if(retry?.requireEmpty&&(snapshot.context.truncated||!Array.isArray(snapshot.context.paragraphs)||
       snapshot.context.paragraphs.some(paragraph=>paragraph.text.trim())||snapshot.context.pictureCount||snapshot.context.inlinePictureCount))
      return {reply:'The Word document already has content. Check the earlier attempt, then resend what you want added.'};
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
    const attachments=[...new Set([...(previous?.files||[]),...files])];
    const images=requestedPaths(request,attachments).filter(isImageAttachment);
    let plan=direct,note='';
    let draftingRequest=request;
    let draftKind=!previous&&!attachments.length&&!images.length?simpleDraft(request):null;
    if(previous?.kind==='topic'&&!attachments.length){
      const followUp=commandText(text,{imperativeOnly:true});
      if(Retry.test(followUp))return {reply:'What should I write about in the Word document?',question:true};
      draftKind=AboutCody.test(followUp)||Proceed.test(followUp)?'introduction':'prose';
      draftingRequest='Write a short draft for the open Word document. Topic supplied by the user: '+text;
    }
    if(!plan&&draftKind==='needs-topic')
      return this.ask(chatId,'What should I write about in the Word document?',request,snapshot.target,attachments,'topic');
    if(!plan&&draftKind==='needs-text')
      return {reply:'Send the exact text in quotes, for example: Type “Hello world” in Word.'};
    if(!plan&&draftKind==='introduction')plan={steps:[{type:'paragraph',text:Introduction,style:'normal'}]};
    if(!plan){
      if(!this.canDraft())throw Error('Choose C.O.D.Y.’s built-in AI connection to draft Word content.');
      if(this.localMemoryOnly())throw Error('Enable your conversational AI connection to draft Word content. Direct Word commands are available locally.');
      const context={...snapshot.context};
      const references=attachments.filter(file=>/\.(?:docx?|rtf|odt|pdf|txt|md)$/i.test(file));
      if(!previous&&!references.length&&DraftWithoutTopic.test(text.trim())&&context.paragraphs?.every(paragraph=>!paragraph.text.trim())&&
        !context.pictureCount&&!context.inlinePictureCount){
        return this.ask(chatId,'What should the document be about?',request,snapshot.target,attachments);
      }
      onProgress('Drafting content for Word…');
      if(references.length){
        if(!this.controller.permissions().filesRead)throw Error("Permission 'filesRead' is disabled");
        const layouts=[];
        for(const file of references.filter(file=>/\.docx$/i.test(file)).slice(0,3)){
          try{layouts.push(await this.readReferenceLayout(file));}
          catch{throw Error(`Could not read the layout in ${path.basename(file)}. Attach a readable .docx reference or describe the formatting you want.`);}
        }
        if(layouts.length&&JSON.stringify({...context,referenceLayouts:layouts}).length<=55000)context.referenceLayouts=layouts;
        const reference=await this.engine.request('attachments-text',{files:references});
        const available=Math.max(0,55000-JSON.stringify(context).length);
        let excerpt=String(reference.context||'').slice(0,available);
        while(excerpt&&JSON.stringify(excerpt).length>available)excerpt=excerpt.slice(0,Math.floor(excerpt.length/2));
        context.reference=excerpt;
      }
      if(signal?.aborted)return {cancelled:true,reply:'Word request cancelled.'};
      const generated=await this.engine.request('word-plan',{
        text:draftingRequest,context:JSON.stringify(context),
        assets:JSON.stringify(images.map((file,index)=>({index,name:path.basename(file)}))),
        insertOnly:draftKind==='prose'
      });
      if(signal?.aborted)return {cancelled:true,reply:'Word request cancelled.'};
      if(typeof generated.question==='string'&&!generated.steps){
        if(!generated.question.trim()||generated.question.length>1000)throw Error('Word returned an invalid clarification.');
        return this.ask(chatId,generated.question,request,snapshot.target,attachments);
      }
      if(typeof generated.answer==='string'&&!generated.steps){
        this.pending.delete(chatId);
        return {reply:generated.answer.slice(0,16000)};
      }
      if(typeof generated.unsupported==='string'&&!generated.steps){
        this.pending.delete(chatId);
        return {reply:'The direct Word editor could not apply this request. '+generated.unsupported.trim().slice(0,600)+' You can ask me to use Computer Use for this separately.'};
      }
      plan=generated;
      note=typeof generated.note==='string'?generated.note.slice(0,1000):'';
    }
    const paths=requestedPaths(request,attachments);
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
