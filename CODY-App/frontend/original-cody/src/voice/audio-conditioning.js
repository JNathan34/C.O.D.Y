'use strict';
const {wavHeader}=require('./azure-speech');
// Keep consonants intact: trim only quiet edges, retaining 160ms either side.
function conditionRecording(input){
  wavHeader(input);const count=(input.length-44)/2;if(count<320)return input;
  let mean=0;for(let i=0;i<count;i++)mean+=input.readInt16LE(44+i*2)/32768;mean/=count;
  const frames=[];let peakFrame=0,peak=0;
  for(let start=0;start<count;start+=320){let energy=0;const end=Math.min(start+320,count);for(let i=start;i<end;i++){const value=input.readInt16LE(44+i*2)/32768-mean;energy+=value*value;peak=Math.max(peak,Math.abs(value));}const rms=Math.sqrt(energy/(end-start));frames.push(rms);peakFrame=Math.max(peakFrame,rms);}
  if(peakFrame<.004)return input;
  const threshold=Math.max(.002,peakFrame*.06),first=frames.findIndex(value=>value>=threshold);
  let last=frames.length-1;while(last>first&&frames[last]<threshold)last--;
  const start=Math.max(0,first*320-2560),end=Math.min(count,(last+1)*320+2560);
  const gain=Math.max(1,Math.min(3,.09/peakFrame,.92/peak));
  const result=Buffer.alloc(44+(end-start)*2);input.copy(result,0,0,44);result.writeUInt32LE(result.length-8,4);result.writeUInt32LE(result.length-44,40);
  for(let i=start;i<end;i++){const value=(input.readInt16LE(44+i*2)/32768-mean)*gain;result.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value))*32767),44+(i-start)*2);}
  return result;
}
module.exports={conditionRecording};
