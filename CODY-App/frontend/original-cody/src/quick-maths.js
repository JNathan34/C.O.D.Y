'use strict';
// Arithmetic only: no JavaScript evaluation or model request.
function quickMaths(input){
  let text=String(input).toLowerCase().trim().replace(/[’']/g,'').replace(/^(?:hey )?c\.?o\.?d\.?y[,.!?:]*\s*/,'').replace(/^(?:please )?(?:what(?:s| is)|calculate|work out|solve)\s+/,'').replace(/[?!.]+$/,'').trim();
  const numbers=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'];
  text=text.replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/g,n=>String(numbers.indexOf(n))).replace(/\b(?:multiplied by|times)\b/g,'*').replace(/\bdivided by\b/g,'/').replace(/\bplus\b/g,'+').replace(/\bminus\b/g,'-').replace(/[×x]/g,'*').replace(/÷/g,'/').replace(/\s+/g,'');
  if(text.length>100||!/^[-+*/^().\d]+$/.test(text)||!/[+*/^-]/.test(text))return null;
  const tokens=text.match(/\d*\.\d+|\d+(?:\.\d*)?|[+*/^()-]/g);if(!tokens||tokens.join('')!==text)return null;
  let i=0;
  const primary=()=>{if(tokens[i]==='('){i++;const n=sum();if(tokens[i++]!==')')throw Error('Check the brackets.');return n;}const n=Number(tokens[i++]);if(!Number.isFinite(n))throw Error('Check the calculation.');return n;};
  const power=()=>{let n=primary();if(tokens[i]==='^'){i++;const e=unary();if(Math.abs(e)>100)throw Error('That power is too large.');n=n**e;}return n;};
  const unary=()=>{if(tokens[i]==='+'){i++;return unary();}if(tokens[i]==='-'){i++;return -unary();}return power();};
  const product=()=>{let n=unary();while(['*','/'].includes(tokens[i])){const op=tokens[i++],b=unary();if(op==='/'&&b===0)throw Error('Cannot divide by zero.');n=op==='*'?n*b:n/b;}return n;};
  const sum=()=>{let n=product();while(['+','-'].includes(tokens[i])){const op=tokens[i++],b=product();n=op==='+'?n+b:n-b;}return n;};
  try{const answer=sum();if(i!==tokens.length||!Number.isFinite(answer))return null;const result=String(Number(answer.toPrecision(12))),expression=text.replace(/\*/g,'×').replace(/\//g,'÷');return {text:`${expression} = ${result}`,answer:result};}catch(error){return {text:error.message,error:true};}
}
module.exports={quickMaths};
