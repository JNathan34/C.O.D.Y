'use strict';
const path=require('node:path');
const {runPowerShell,psQuote}=require('./windows');

const STYLES=new Set(['normal','title','heading1','heading2','label']);
const ALIGNMENTS=new Set(['left','center','right','justify']);
const SCOPES=new Set(['cursor','selection','paragraph','document','append']);
// PowerShell cannot read Electron's virtual ASAR filesystem.
const SCRIPT=path.join(__dirname,'../../windows/word-document.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);

function wordIntent(text,selected=false,pending=false){
  if(selected||pending)return true;
  if(/\b(?:picture|photo|image)\b.*\b(?:wrap|top right|right side)\b|\b(?:move|put)\b.*\b(?:new|next) page\b|\bformat\b.*\b(?:explanations|paragraphs|labels|spacing)\b/i.test(text))return true;
  return /\b(?:Word (?:document|file|window|app)|(?:in|into|using|with|Microsoft) Word|(?:edit|format|save|open) Word|(?:this|my|the|current|open) document)\b/i.test(text)&&
    /\b(?:make|create|write|type|draft|revise|rewrite|edit|format|read|show|summarise|summarize|put|insert|add|append|layout|lay out|picture|photo|wrap|export|save|open)\b/i.test(text);
}

function formatting(step){
  const result={};
  if(step.style!==undefined){
    if(!STYLES.has(step.style))throw Error('Unsupported Word paragraph style.');
    result.style=step.style;
  }
  if(step.align!==undefined){
    if(!ALIGNMENTS.has(step.align))throw Error('Unsupported Word alignment.');
    result.align=step.align;
  }
  for(const key of ['bold','italic','underline']){
    if(step[key]!==undefined){
      if(typeof step[key]!=='boolean')throw Error('Invalid Word text formatting.');
      result[key]=step[key];
    }
  }
  for(const [key,min,max] of [['fontSize',6,72],['spaceBefore',0,72],['spaceAfter',0,72],['lineSpacing',1,2]]){
    if(step[key]!==undefined){
      if(!Number.isFinite(step[key])||step[key]<min||step[key]>max)throw Error('Invalid Word spacing or font size.');
      result[key]=step[key];
    }
  }
  if(step.list!==undefined){
    if(!['none','bullet','number'].includes(step.list))throw Error('Unsupported Word list.');
    result.list=step.list;
  }
  return result;
}

function validatePlan(plan,{images=[],paths=[],allowSave=false}={}){
  if(!plan||typeof plan!=='object'||!Array.isArray(plan.steps)||!plan.steps.length||plan.steps.length>120)
    throw Error('Word returned an unsupported document plan.');
  let characters=0;
  const steps=plan.steps.map(step=>{
    if(!step||typeof step!=='object')throw Error('Invalid Word document step.');
    const output={type:step.type};
    switch(step.type){
      case 'paragraph':case 'replace':
        if(typeof step.text!=='string'||step.text.includes('\0'))throw Error('Invalid document text.');
        characters+=step.text.length;
        output.text=step.text;
        if(step.type==='paragraph')output.style=step.style??'normal';
        Object.assign(output,formatting(step));
        if(step.type==='replace'){
          if(step.paragraph!==undefined){
            if(!Number.isInteger(step.paragraph)||step.paragraph<1||step.paragraph>120)throw Error('Invalid paragraph number.');
            output.paragraph=step.paragraph;
          }
        }
        break;
      case 'format':case 'select':
        if(!SCOPES.has(step.scope))throw Error('Choose the Word text to format.');
        output.scope=step.scope;
        if(step.paragraph!==undefined){
          if(!Number.isInteger(step.paragraph)||step.paragraph<1||step.paragraph>120)throw Error('Invalid paragraph number.');
          output.paragraph=step.paragraph;
        }
        if(step.type==='format')Object.assign(output,formatting(step));
        break;
      case 'picture':case 'picture-format':
        if(step.type==='picture'){
          if(!Number.isInteger(step.image)||!images[step.image])throw Error('Attach the picture you want to insert.');
          output.path=images[step.image];
        }
        if(step.index!==undefined){
          if(!Number.isInteger(step.index)||step.index<1||step.index>100)throw Error('Invalid picture number.');
          output.index=step.index;
        }
        if(step.paragraph!==undefined){
          if(!Number.isInteger(step.paragraph)||step.paragraph<1||step.paragraph>120)throw Error('Invalid picture anchor.');
          output.paragraph=step.paragraph;
        }
        output.align=step.align??'right';
        output.wrap=step.wrap??'square';
        if(!['left','center','right'].includes(output.align)||!['square','tight','inline','top-bottom'].includes(output.wrap))
          throw Error('Unsupported picture position or wrapping.');
        for(const [key,min,max]of [['width',36,500],['cropLeft',0,500],['cropRight',0,500],['cropTop',0,500],['cropBottom',0,500],['top',0,500]]){
          if(step[key]!==undefined){
            if(!Number.isFinite(step[key])||step[key]<min||step[key]>max)throw Error('Invalid picture dimensions.');
            output[key]=step[key];
          }
        }
        break;
      case 'page-break':case 'save':break;
      case 'open':case 'save-as':case 'export-pdf':
        if(typeof step.path!=='string'||!paths.includes(step.path))throw Error('Specify the file path for this document operation.');
        output.path=path.resolve(step.path);
        if(step.type==='open'&&!/\.(?:docx?|rtf|odt)$/i.test(step.path))throw Error('Choose a Word document.');
        if(step.type==='save-as'&&!/\.docx$/i.test(step.path))throw Error('Save editable documents as .docx.');
        if(step.type==='export-pdf'&&!/\.pdf$/i.test(step.path))throw Error('Choose a .pdf output path.');
        break;
      default:throw Error('This Word operation needs a more specific request. Use the document controls or describe the change.');
    }
    if(['save','save-as','export-pdf'].includes(step.type)&&!allowSave)throw Error('Ask to save or export the document before writing a file.');
    return output;
  });
  if(characters>25000)throw Error('Edit up to 25,000 characters in one Word request.');
  if(steps.some((step,i)=>step.type==='open'&&(i!==0||steps.length!==1)))throw Error('Open the document first, then request its edits.');
  // File writes come last so a failed layout can be undone before it is saved.
  const firstWrite=steps.findIndex(step=>['save','save-as','export-pdf'].includes(step.type));
  if(firstWrite>=0&&steps.slice(firstWrite).some(step=>!['save','save-as','export-pdf'].includes(step.type)))
    throw Error('Save and export must follow the document edits.');
  return {steps};
}

function requestedPaths(text,files=[]){
  const quoted=[...text.matchAll(/["“]((?:[a-z]:[\\/]|\\\\)[^"”\r\n]+)["”]/gi)].map(match=>match[1]);
  return [...new Set([...files,...quoted])];
}

function directPlan(text,files=[]){
  text=text.trim().replace(/^(?:(?:hey\s+)?cody[,\s]+|(?:can|could|would) you\s+|please\s+)+/i,'');
  const selection=/\b(?:selected|selection)\b/i.test(text)?'selection':'paragraph';
  let match;
  if((match=/^select paragraph (\d+)\s*[.!]?$/i.exec(text)))
    return {steps:[{type:'select',scope:'paragraph',paragraph:Number(match[1])}]};
  if(/^underline (?:this|the|selected|current) (?:text|selection|paragraph)[.!]?$/i.test(text))
    return {steps:[{type:'format',scope:selection,underline:true}]};
  if((match=/^(?:align (?:this|the|selected|current) (?:paragraph|text|selection) (?:to )?(?:the )?(left|center|centre|right)|(?:align )?(center|centre|justify) (?:this|the|selected|current) (?:paragraph|text|selection))[.!]?$/i.exec(text))){
    const align=(match[1]||match[2]).toLowerCase().replace('centre','center');
    return {steps:[{type:'format',scope:selection,align}]};
  }
  if((match=/^(?:set|change) (?:(?:this|the|selected|current) (?:paragraph|text|selection)(?:'s)? )?(?:the )?font size (?:to )?(\d+(?:\.\d+)?)(?:\s*(?:pt|points?))?[.!]?$/i.exec(text)))
    return {steps:[{type:'format',scope:selection,fontSize:Number(match[1])}]};
  if((match=/^(?:make|format|turn) (?:this|the|selected|current) (?:text|paragraphs?|selection) (?:as |into )?(?:a )?(bullet|numbered) list[.!]?$/i.exec(text)))
    return {steps:[{type:'format',scope:selection,list:match[1].toLowerCase()==='bullet'?'bullet':'number'}]};
  if((match=/^(?:set|change) (?:the )?(?:paragraph )?spacing (before|after) (?:to )?(\d+(?:\.\d+)?)(?: points?)?[.!]?$/i.exec(text)))
    return {steps:[{type:'format',scope:selection,[match[1].toLowerCase()==='before'?'spaceBefore':'spaceAfter']:Number(match[2])}]};
  if((match=/^(?:set|change) (?:the )?line spacing (?:to )?(\d+(?:\.\d+)?)[.!]?$/i.exec(text)))
    return {steps:[{type:'format',scope:selection,lineSpacing:Number(match[1])}]};
  if(/^(?:(?:put|place|insert|add) (?:this |the |my )?(?:picture|photo|image) (?:at |on )?(?:the )?(?:top )?right(?: and (?:make )?(?:the )?text wrap(?: around it)?)?|wrap (?:the )?text around (?:this|the) (?:picture|photo|image))[.!]?$/i.test(text)){
    const pictures=files.filter(file=>/\.(?:png|jpe?g|gif|webp|bmp|tiff?)$/i.test(file));
    if(pictures.length>1)throw Error('Choose one picture to place, or describe which attachment to use.');
    return {steps:[{type:pictures.length?'picture':'picture-format',...(pictures.length?{image:0}:{}),align:'right',wrap:'square',width:180}]};
  }
  const quotedPaths=requestedPaths(text,files);
  if(/^\s*(?:please\s+)?open (?:this|the|my) (?:Word )?(?:document|file)\s*[.!]?$/i.test(text)){
    const documents=files.filter(file=>/\.(?:docx?|rtf|odt)$/i.test(file));
    if(documents.length===1)return validatePlan({steps:[{type:'open',path:documents[0]}]},{paths:documents});
  }
  match=/^\s*(?:please\s+)?(open(?: (?:the |my )?(?:Word )?document)?|save as|save (?:this |the )?document as|export(?: (?:this|the) document)?(?: as| to)?(?: pdf)?)\s+["“]((?:[a-z]:[\\/]|\\\\)[^"”\r\n]+)["”]\s*[.!]?$/i.exec(text);
  if(!match)return null;
  const type=/^open/i.test(match[1])?'open':/^export/i.test(match[1])?'export-pdf':'save-as';
  return validatePlan({steps:[{type,path:match[2]}]},{paths:quotedPaths,allowSave:true});
}

function script(){
  return "[Console]::InputEncoding=[Text.Encoding]::UTF8\n"+
    "try { $payload=[Console]::In.ReadToEnd()|ConvertFrom-Json\n. "+psQuote(SCRIPT)+
    " } catch { [Console]::Error.Write($_.Exception.Message); exit 1 }";
}

function decode(raw){
  let result;
  try{result=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('Word did not return a verified document result.');}
  if(!result||typeof result!=='object')throw Error('Word did not return a document result.');
  return result;
}

async function snapshot({runner=runPowerShell}={}){
  const result=decode(await runner(script(),{timeout:18000,input:JSON.stringify({mode:'snapshot'})}));
  if(result.ok!==true||typeof result.target?.fingerprint!=='string'||!/^-?\d+$/.test(result.target.window))
    throw Error('Could not identify the active Word document.');
  return result;
}

async function referenceLayout(file,{runner=runPowerShell}={}){
  const result=decode(await runner(script(),{timeout:12000,input:JSON.stringify({mode:'reference-layout',path:file})}));
  if(result.ok!==true||!Array.isArray(result.paragraphs))throw Error('Word did not return a formatting reference.');
  return {name:path.basename(file),paragraphs:result.paragraphs};
}

async function execute(plan,target,{runner=runPowerShell,signal,overwrite=[]}={}){
  if(signal?.aborted)throw Error('Word editing cancelled.');
  // Let Word finish or roll back its undo record once an atomic batch has begun.
  const result=decode(await runner(script(),{timeout:0,input:JSON.stringify({mode:'execute',plan,target,overwrite})}));
  if(result.ok!==true||result.completed!==plan.steps.length||typeof result.document!=='string')
    throw Error('Word did not verify every requested document operation.');
  return result;
}

module.exports={wordIntent,formatting,validatePlan,requestedPaths,directPlan,script,snapshot,referenceLayout,execute};
