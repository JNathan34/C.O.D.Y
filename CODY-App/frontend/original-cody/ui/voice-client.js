'use strict';
// Audio capture and PCM formatting. Recognition begins only after capture stops.
(function(){
 function resampleTo16k(samples,sampleRate){
   if(!Number.isFinite(sampleRate)||sampleRate<16000)throw Error('Unsupported microphone sample rate');
   const ratio=sampleRate/16000;
   const length=Math.floor(samples.length/ratio);
   const output=new Int16Array(length);
   for(let i=0;i<length;i++){
     const start=Math.floor(i*ratio),end=Math.min(samples.length,Math.max(start+1,Math.floor((i+1)*ratio)));
     let sum=0;for(let j=start;j<end;j++)sum+=samples[j];
     const clamped=Math.min(1,Math.max(-1,sum/(end-start)));
     output[i]=clamped<0?Math.round(clamped*32768):Math.round(clamped*32767);
   }
   return output;
 }
 function wavFromSamples(samples,sampleRate){
   const pcm=resampleTo16k(samples,sampleRate);const bytes=new ArrayBuffer(44+pcm.length*2),v=new DataView(bytes);
   const word=(at,value)=>v.setUint32(at,value,true),half=(at,value)=>v.setUint16(at,value,true);
   const tag=(at,str)=>{for(let i=0;i<str.length;i++)v.setUint8(at+i,str.charCodeAt(i));};
   tag(0,'RIFF');word(4,bytes.byteLength-8);tag(8,'WAVE');tag(12,'fmt ');word(16,16);half(20,1);half(22,1);word(24,16000);word(28,32000);half(32,2);half(34,16);tag(36,'data');word(40,pcm.length*2);
   for(let i=0;i<pcm.length;i++)v.setInt16(44+i*2,pcm[i],true);
   return new Uint8Array(bytes);
 }
 function base64Bytes(bytes){let result='';for(let i=0;i<bytes.length;i+=16384)result+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(result);}
 function recordingQuality(samples){
   let energy=0,peak=0,clipped=0;
   for(const value of samples){energy+=value*value;peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>=.98)clipped++;}
   const rms=samples.length?Math.sqrt(energy/samples.length):0;
   return {rms,peak,clippedRatio:samples.length?clipped/samples.length:0,level:rms<.004?'quiet':clipped>samples.length*.01?'clipping':'good'};
 }
 function microphoneError(error){
   if(['NotAllowedError','PermissionDeniedError'].includes(error.name))return Error('Microphone access is blocked. In Windows Settings → Privacy & security → Microphone, enable Microphone access and Let desktop apps access your microphone, then try again.');
   if(error.name==='NotFoundError')return Error('No microphone was found. Connect a microphone and select it in Windows Sound settings.');
   if(error.name==='NotReadableError')return Error('Windows could not open the microphone. Check that it is enabled and another app is not using it exclusively.');
   if(error.name==='OverconstrainedError')return Error('The selected microphone is unavailable. Choose an available microphone in Settings → Microphone.');
   return error;
 }
 class MicRecorder{
   constructor(){this.recording=false;this.parts=[];this.total=0;}
   async start(onLevel=()=>{}){
     if(this.recording)throw Error('Already recording');
     let media;
     try{media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true,...(this.deviceId?{deviceId:{exact:this.deviceId}}:{})}});}catch(error){throw microphoneError(error);}
     let ctx;
     try{
       // Let Chromium resample the microphone correctly for speech instead of
       // relying on a three-sample box average from a 48 kHz device.
       ctx=new AudioContext({sampleRate:16000});await ctx.resume();const source=ctx.createMediaStreamSource(media);
       const node=ctx.createScriptProcessor(1024,1,1),mute=ctx.createGain();mute.gain.value=0;
       this.deviceLabel=media.getAudioTracks()[0]?.label||'System default microphone';
       this.media=media;this.ctx=ctx;this.source=source;this.node=node;this.mute=mute;this.parts=[];this.total=0;this.recording=true;
       node.onaudioprocess=event=>{if(!this.recording)return;const data=event.inputBuffer.getChannelData(0);this.parts.push(Float32Array.from(data));this.total+=data.length;let s=0;for(const v of data)s+=v*v;onLevel(Math.sqrt(s/data.length));};
       source.connect(node);node.connect(mute);mute.connect(ctx.destination);
       return {sampleRate:ctx.sampleRate};
     }catch(e){media.getTracks().forEach(t=>t.stop());if(ctx)await ctx.close().catch(()=>{});throw e;}
   }
   async stop(){
     if(!this.recording)return null;
     // Drain the last audio callback and consonant instead of chopping the
     // recording at the exact instant the shortcut is released.
     await new Promise(resolve=>setTimeout(resolve,120));
     if(!this.recording)return null;
     this.recording=false;this.node.disconnect();this.source.disconnect();this.mute.disconnect();this.media.getTracks().forEach(t=>t.stop());
     const sampleRate=this.ctx.sampleRate;await this.ctx.close();
     const seconds=this.total/sampleRate;
     if(seconds<0.25)throw Error('Recording too short');if(seconds>30.5)throw Error('Recording exceeds 30 seconds');
     const samples=new Float32Array(this.total);let offset=0;for(const p of this.parts){samples.set(p,offset);offset+=p.length;}this.parts=[];this.total=0;
     return {base64:base64Bytes(wavFromSamples(samples,sampleRate)),seconds,quality:recordingQuality(samples),deviceLabel:this.deviceLabel};
   }
   async cancel(){if(this.recording){this.recording=false;this.node.disconnect();this.source.disconnect();this.mute.disconnect();this.media.getTracks().forEach(t=>t.stop());await this.ctx.close();}this.parts=[];this.total=0;}
 }
 if(typeof window!=='undefined')window.CODYVoiceRecorder=MicRecorder;
 if(typeof module!=='undefined')module.exports={wavFromSamples,resampleTo16k,microphoneError,recordingQuality};
})();
