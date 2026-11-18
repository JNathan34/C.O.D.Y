'use strict';
const {commandText}=require('./command-text');
function isProofreadCommand(input){
  return /^(?:(?:proof\s*read|spell\s*check)(?: (?:this|that|it|my text|this text|the text|my spelling|this field|the selected text))?|(?:check|fix|correct) (?:the |my )?spelling(?: (?:in|of) (?:this|this text|this field))?|fix (?:the )?typos (?:in )?(?:this|this text|this field))$/i.test(commandText(input,{preserveShow:true}));
}
module.exports={isProofreadCommand};
