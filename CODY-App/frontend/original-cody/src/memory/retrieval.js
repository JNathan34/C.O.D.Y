'use strict';
// Offline concept expansion plus TF-IDF cosine retrieval. No external embedding
// requests, model downloads or claims of a general neural semantic model.
const concepts=[['hardware','specification','specs','processor','cpu','ram','memory','machine','server','computer'],['voice','spoken','speech','tts','speak','audio'],['brief','short','shorter','concise','length'],['project','application','app','code','repository','workspace'],['preference','prefer','like','want'],['bug','error','failure','broken','issue'],['continue','resume','previous','history','session']];
const stop=new Set('a an the is are was were be to of for and or in on at i me my you your it that this what which do does can could tell about uses use please remember know'.split(' '));
function tokens(text){return (String(text).toLowerCase().match(/[\p{L}\p{N}_-]+/gu)||[]).filter(t=>t.length>1&&!stop.has(t)).map(t=>t.replace(/(?:ations|ation|ing|ed|s)$/,'')||t);}
const groups=concepts.map(words=>new Set(words.flatMap(tokens)));
function features(text){const map=new Map();for(const token of tokens(text))map.set(token,(map.get(token)||0)+1);for(let i=0;i<groups.length;i++)if([...map.keys()].some(t=>groups[i].has(t)))map.set('@concept'+i,1.2);return map;}
function rank(query,records){const q=features(query);if(!q.size)return [];const docs=records.map(record=>({record,f:features(record.text)})),df=new Map();for(const {f}of docs)for(const term of f.keys())df.set(term,(df.get(term)||0)+1);
 const vector=f=>new Map([...f].map(([t,n])=>[t,(1+Math.log(n))*(1+Math.log((docs.length+1)/((df.get(t)||0)+1)))]));const vq=vector(q),norm=v=>Math.sqrt([...v.values()].reduce((sum,n)=>sum+n*n,0));const nq=norm(vq);
 return docs.map(({record,f})=>{const v=vector(f);let dot=0;for(const[t,n]of vq)dot+=n*(v.get(t)||0);return {...record,score:dot/(nq*norm(v)||1)};}).filter(r=>r.score>=.075).sort((a,b)=>b.score-a.score||b.updatedAt.localeCompare(a.updatedAt));
}
module.exports={rank};
