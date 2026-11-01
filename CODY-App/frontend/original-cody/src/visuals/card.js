'use strict';
// Only declarative marks reach the supplied painter. Its program/eval APIs are
// deliberately not exposed to the model or IPC; the overlay CSP also blocks eval.
const TYPES=['line','arrow','circle','ellipse','rect','text','highlight'];
function marks(input){
 if(!Array.isArray(input)||input.length<1||input.length>64)throw Error('A visual card needs 1–64 marks');
 const n=(v,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('Invalid card coordinate or size');return v;};
 const point=p=>{if(!Array.isArray(p)||p.length!==2)throw Error('Invalid card point');return p.map(v=>n(v,0,1000));};
 return input.map(m=>{
  if(!m||typeof m!=='object'||Array.isArray(m)||!TYPES.includes(m.do))throw Error('Unsupported card mark');
  const common=['do','tone','size'],specific=['line','arrow'].includes(m.do)?['pts']:m.do==='text'?['at','text','style']:['at',...(['rect','highlight'].includes(m.do)?['w','h']:m.do==='circle'?['r']:['rx','ry'])];
  if(Object.keys(m).some(k=>![...common,...specific].includes(k)))throw Error('Unsupported card field');
  const out={do:m.do,tone:m.tone||'#009DFF'};if(!/^#[\da-f]{6}$/i.test(out.tone))throw Error('Use a hex card colour');
  if(m.size!==undefined)out.size=n(m.size,1,m.do==='text'?64:12);
  if(specific.includes('pts')){if(!Array.isArray(m.pts)||m.pts.length<2||m.pts.length>32)throw Error('Invalid card path');out.pts=m.pts.map(point);}
  else out.at=point(m.at);
  if(m.style!==undefined&&m.style!=='ui')throw Error('Unsupported card text style');
  if(m.do==='text'){if(typeof m.text!=='string'||!m.text.trim()||m.text.length>200)throw Error('Invalid card text');out.text=m.text;out.style='ui';out.size=m.size||20;}
  for(const k of ['w','h','r','rx','ry'])if(specific.includes(k))out[k]=n(m[k],.1,1000);
  return out;
 });
}
module.exports={marks,TYPES};
