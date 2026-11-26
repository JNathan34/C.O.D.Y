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

function answerTransfer(text,wordSelected=false){
  const command=commandText(text,{imperativeOnly:true});
  const destination=new RegExp('\\s+(?:in|into|to|inside|onto)\\s+'+WORD_TARGET+'(?:\\s*,?\\s*please)?[.!?]*$','i');
  if(!destination.test(command)&&!wordSelected)return null;
  const request=command.replace(destination,'').replace(/[.!?]+$/,'').trim();
  const match=/^(?:put|place|add|insert|copy|transfer|send|move|write|type|include)\s+(.+)$/i.exec(request);
  if(!match||/["“”]/.test(match[1]))return null;
  const subject=match[1].replace(/what you (?:just )?(?:said|told me|explained|showed me)/i,'the answer');
  if(!/\b(?:it|that|this|everything|answer|response|explanation|text|words|drawings?|diagrams?|illustrations?|pictures?|photos?|images?)\b/i.test(subject))return null;
  if(!/^(?:(?:it|that|this|everything|all|of|the|your|previous|last|whole|full|entire|just|given|above|answer|response|explanation|text|words|drawing|drawings|diagram|diagrams|illustration|illustrations|picture|pictures|photo|photos|image|images|sources|references|and|with|including|too|also|as|well|only|without|no)\s*)+$/i.test(subject))return null;
  const visual=/\b(?:drawings?|diagrams?|illustrations?|pictures?|photos?|images?)\b/i.test(subject);
  const words=/\b(?:answer|response|explanation|text|words)\b/i.test(subject);
  const textOnly=/\b(?:without|no)\b/i.test(subject)||/\b(?:only|just)\b/i.test(subject)&&words||
    /\b(?:text|words)\b/i.test(subject)&&!visual;
  return {text:!visual||words||/\b(?:it|that|this|everything)\b/i.test(subject),visuals:!textOnly};
}

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
  constructor({controller,engine,localMemoryOnly=()=>false,canDraft=()=>true,readReferenceLayout=referenceLayout,prepareImages=async images=>images}){
    Object.assign(this,{controller,engine,localMemoryOnly,canDraft,readReferenceLayout,prepareImages});
    this.pending=new Map();
  }
  matches(text,chatId,capabilityId,localRoute){
    if(!this.controller||capabilityId&&capabilityId!=='plugin:word')return false;
    if(capabilityId==='plugin:word'&&parseWordCommand(text))return false;
    if(localRoute)return false;
    if(answerTransfer(text,capabilityId==='plugin:word'))return true;
    if(parseWordInsertion(text,{wordSelected:false}))return true;
    if(simpleDraft(text,{explicitWord:true}))return true;
    if(directPlan(text))return true;
    return wordIntent(text,capabilityId==='plugin:word',this.pending.has(chatId));
  }
  transfer(text,messages,currentMessageId,wordSelected=false){
    if(!this.controller)return null;
    const requested=answerTransfer(text,wordSelected);
    if(!requested)return null;
    const history=Array.isArray(messages)?messages:[];
    const currentIndex=currentMessageId?history.findIndex(message=>message.id===currentMessageId):-1;
    const recent=history.slice(0,currentIndex<0?history.length:currentIndex);
    let answer;
    for(let index=recent.length-1;index>=0;index--){
      const message=recent[index];
      if(message.role!=='assistant'||!message.text?.trim())continue;
      if(message.wordTransferSourceId){
        answer=recent.find(source=>source.id===message.wordTransferSourceId);
        break;
      }
      const request=recent.slice(0,index).findLast(item=>item.role==='user');
      if(request&&answerTransfer(request.text,request.mention?.id==='plugin:word'))continue;
      answer=message;
      break;
    }
    if(!answer)return {reply:'Ask me a question first, then tell me to put the answer in Word.'};
    return {...requested,source:answer};
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
  async run({chatId,text,files=[],signal,wordSelected=false,retry=null,transfer=null,onProgress=()=>{}}){
    if(/^\s*(?:cancel|never mind|stop)\s*[.!]?$/i.test(text)){
      this.pending.delete(chatId);
      return {reply:'Word request cancelled.',cancelled:true};
    }
    if(signal?.aborted)return {cancelled:true,reply:'Word request cancelled.'};
    if(retry?.reply)return {reply:retry.reply};
    if(transfer){
      if(transfer.reply)return {reply:transfer.reply};
      if(files.length)throw Error('Remove attached files before copying the previous answer to Word.');
      if(transfer.visuals&&transfer.source.wordImages===null)
        throw Error('The drawings from that answer could not be saved. Ask Cody to redraw them before inserting the answer with its images.');
      const images=transfer.visuals?await this.prepareImages(transfer.source.wordImages||[]):[];
      if(!transfer.text&&!images.length)return {reply:'That answer has no saved drawings or images to insert. Ask me to include its text instead.'};
      const steps=[];
      if(transfer.text)steps.push({type:'paragraph',text:transfer.source.text,style:'normal'});
      for(let image=0;image<images.length;image++){
        if(image>0)steps.push({type:'paragraph',text:'',style:'normal'});
        steps.push({type:'picture',image,wrap:'inline',align:'left',width:432});
      }
      const plan={steps};
      validatePlan(plan,{images});
      const snapshot=await this.controller.readWord();
      if(signal?.aborted)return {cancelled:true,reply:'Word request cancelled.'};
      onProgress('Inserting the answer in Word…');
      const result=await this.controller.execute('word.document',{plan,target:snapshot.target,images,paths:[],allowSave:false},
        {origin:'chat',signal,humanTask:text});
      if(result.cancelled)return {cancelled:true,reply:'Word edits cancelled.'};
      this.pending.delete(chatId);
      return {reply:`Added ${transfer.text?'the answer':''}${transfer.text&&images.length?' and ':''}${images.length?`${images.length} ${images.length===1?'image':'images'}`:''} to ${result.result.document}.`,
        result:result.result,sourceId:transfer.source.id};
    }
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
