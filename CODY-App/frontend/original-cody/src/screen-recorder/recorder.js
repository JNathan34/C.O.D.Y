'use strict';
let recorder,stream,queue=Promise.resolve(),queued=0,sequence=0,session,ending=false;
const api=window.screenRecorder;
function release(){ending=true;stream?.getTracks().forEach(track=>track.stop());stream=null;recorder=null;}
api.onCommand(async command=>{
  try{
    if(command.action==='start'){
      if(recorder)throw Error('A screen recording is already running.');
      session=command.session;ending=false;sequence=0;queue=Promise.resolve();queued=0;
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:command.sourceId,maxWidth:Math.min(1920,command.width),maxHeight:Math.min(1080,command.height),maxFrameRate:30}}});
      const mimeType=['video/mp4;codecs=avc1.42001E','video/mp4;codecs=avc1'].find(type=>MediaRecorder.isTypeSupported(type));
      if(!mimeType)throw Error('This device does not support H.264 MP4 screen recording.');
      recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:5000000});
      recorder.ondataavailable=event=>{
        if(!event.data.size)return;queued+=event.data.size;
        if(queued>32*1024*1024){api.failure('Recording could not keep up with disk writes.');release();return;}
        const index=sequence++;
        queue=queue.then(async()=>{const bytes=await event.data.arrayBuffer();await api.chunk({session,sequence:index,bytes});queued-=event.data.size;});
        queue.catch(error=>{api.failure(error.message);release();});
      };
      recorder.onerror=event=>{api.failure(event.error?.message||'Video encoder failed.');release();};
      stream.getVideoTracks()[0].onended=()=>{if(!ending)api.failure('The captured screen became unavailable.');};
      await new Promise((resolve,reject)=>{recorder.onstart=resolve;recorder.onerror=event=>reject(event.error||Error('Video encoder could not start.'));recorder.start(1000);});
      recorder.onerror=event=>{api.failure(event.error?.message||'Video encoder failed.');release();};
    }else if(command.action==='pause'||command.action==='resume'){
      if(!recorder)throw Error('Screen recording is unavailable.');
      const current=recorder;await new Promise(resolve=>{current.addEventListener(command.action,resolve,{once:true});current[command.action]();});
    }else if(command.action==='stop'){
      if(!recorder)throw Error('Screen recording is unavailable.');
      ending=true;const current=recorder;
      await new Promise(resolve=>{current.addEventListener('stop',resolve,{once:true});current.stop();});
      await queue;release();
    }else throw Error('Invalid screen recorder command.');
    api.response({id:command.id,result:{ok:true}});
  }catch(error){release();api.response({id:command.id,error:error.message});}
});
