'use strict';
// Display/history keep the official name; only speech input gets pronunciation.
function speechText(text){
 if(typeof text!=='string')return text;
 return text.replace(/\bC\s*\.\s*O\s*\.\s*D\s*\.\s*Y\b|\bCODY\b/gi,'Cody')
   .replace(/\bCody\.(?=[,;:'’])/g,'Cody');
}
module.exports={speechText};
