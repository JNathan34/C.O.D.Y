'use strict';
const {commandText}=require('./command-text');
function isProofreadCommand(input){
  return /^(?:(?:proof\s*read|spell\s*check)(?: (?:this|that|it|my text|this text|the text|my spelling))?|(?:check|fix|correct) (?:the |my )?spelling(?: (?:in|of) (?:this|this text))?)$/i.test(commandText(input,{preserveShow:true}));
}
module.exports={isProofreadCommand};
