'use strict';
const {commandText}=require('./command-text');
const RGB_PLUGIN_ID='plugin:rgb-lighting';
const RGB_DISABLED_MESSAGE='Turn on RGB Lighting in Settings → Plugins first.';

const COLORS={red:'#ff0000',orange:'#ff8000',yellow:'#ffff00',green:'#00ff00',lime:'#80ff00',blue:'#0060ff',
  purple:'#8c20ff',violet:'#8c20ff',pink:'#ff48a8',magenta:'#ff00ff',cyan:'#00ffff',teal:'#00bcbc',
  white:'#ffffff','warm white':'#ffd5a0','cool white':'#d5eaff',black:'#000000',off:'#000000'};

function parseRgbCommand(input,{selected=false}={}){
  const text=commandText(input).toLowerCase();
  if(/^(?:(?:open|show|launch) (?:the |my )?)?(?:r[. ]*g[. ]*b\.?|lighting) controls?$/.test(text))return {action:'rgb.open'};
  if(selected&&/^(?:open|show|open controls?|show controls?)$/.test(text))return {action:'rgb.open'};
  if(/^turn off (?:(?:the|my) )?(?:pc |rgb )?(?:lights|lighting)$/.test(text))return {action:'rgb.color',args:{color:COLORS.off}};
  const target=/^(?:set|change|make|turn) (?:(?:the|my) )?(?:pc |rgb )?(?:lights|lighting)(?: to)? (.+)$/.exec(text)?.[1]??
    (selected?text.replace(/^set (?:to )?/,''):'');
  const color=Object.hasOwn(COLORS,target)?COLORS[target]:/^#[0-9a-f]{6}$/.test(target)?target:null;
  if(typeof color==='string')return {action:'rgb.color',args:{color}};
  return null;
}

module.exports={parseRgbCommand,RGB_PLUGIN_ID,RGB_DISABLED_MESSAGE};
