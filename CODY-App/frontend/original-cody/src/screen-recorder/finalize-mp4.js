'use strict';
const fs=require('node:fs/promises');

// MediaRecorder emits fragmented MP4. Its initial movie duration can be zero
// and its track durations can describe only the first fragment. Windows then
// displays an unknown-duration sentinel as thousands of hours. Finalize the
// headers from the actual sample timeline without changing encoded video.
function boxes(bytes,start=0,end=bytes.length){
  const result=[];
  for(let offset=start;offset<end;){
    if(offset+8>end)throw Error('Truncated MP4 box.');
    const size=bytes.readUInt32BE(offset);
    if(size<8||offset+size>end)throw Error('Invalid MP4 box size.');
    result.push({type:bytes.toString('ascii',offset+4,offset+8),offset,data:offset+8,end:offset+size});
    offset+=size;
  }
  return result;
}
function child(bytes,parent,type){
  const box=boxes(bytes,parent.data,parent.end).find(item=>item.type===type);
  if(!box)throw Error(`Missing MP4 ${type} box.`);
  return box;
}
function field(bytes,box,shortOffset,longOffset){
  const version=bytes[box.data];
  if(version!==0&&version!==1)throw Error('Unsupported MP4 header version.');
  return box.data+(version===1?longOffset:shortOffset);
}
function duration(bytes,box,value,shortOffset,longOffset){
  const offset=field(bytes,box,shortOffset,longOffset),length=bytes[box.data]===1?8:4;
  if(offset+length>box.end||!Number.isSafeInteger(value)||value<0||(length===4&&value>0xffffffff))throw Error('Invalid MP4 duration.');
  if(length===8)bytes.writeBigUInt64BE(BigInt(value),offset);else bytes.writeUInt32BE(value,offset);
}
async function finalizeMp4(filename){
  const file=await fs.open(filename,'r+');
  try{
    const {size}=await file.stat();let movie,movieOffset;const fragments=[];
    // Read only metadata boxes, never buffer the full recording in memory.
    for(let offset=0;offset<size;){
      const header=Buffer.alloc(8);const read=await file.read(header,0,8,offset);
      if(read.bytesRead!==8)throw Error('Truncated MP4 header.');
      let length=header.readUInt32BE(0);const type=header.toString('ascii',4,8);
      if(length===1){const extended=Buffer.alloc(8);await file.read(extended,0,8,offset+8);length=Number(extended.readBigUInt64BE());}
      if(length===0)length=size-offset;
      if(!Number.isSafeInteger(length)||length<8||offset+length>size)throw Error('Invalid MP4 box size.');
      if(type==='moov'||type==='moof'){
        if(length>16*1024*1024)throw Error('MP4 metadata is too large.');
        const bytes=Buffer.alloc(length);const read=await file.read(bytes,0,length,offset);
        if(read.bytesRead!==length)throw Error('Truncated MP4 metadata.');
        if(type==='moov'){movie=bytes;movieOffset=offset;}else fragments.push(bytes);
      }
      offset+=length;
    }
    if(!movie||!fragments.length)throw Error('Recording has no fragmented MP4 video.');
    const root=boxes(movie)[0],mvhd=child(movie,root,'mvhd');
    const movieScale=movie.readUInt32BE(field(movie,mvhd,12,20));
    const tracks=new Map(),defaults=new Map();
    for(const box of boxes(movie,root.data,root.end)){
      if(box.type==='trak'){
        const tkhd=child(movie,box,'tkhd'),mdia=child(movie,box,'mdia'),mdhd=child(movie,mdia,'mdhd');
        const id=movie.readUInt32BE(field(movie,tkhd,12,20));
        tracks.set(id,{tkhd,mdhd,scale:movie.readUInt32BE(field(movie,mdhd,12,20)),end:0});
      }else if(box.type==='mvex'){
        for(const trex of boxes(movie,box.data,box.end))if(trex.type==='trex')defaults.set(movie.readUInt32BE(trex.data+4),movie.readUInt32BE(trex.data+12));
      }
    }
    for(const bytes of fragments){
      const moof=boxes(bytes)[0];
      for(const traf of boxes(bytes,moof.data,moof.end).filter(box=>box.type==='traf')){
        const tfhd=child(bytes,traf,'tfhd'),tfdt=child(bytes,traf,'tfdt');
        const flags=bytes.readUInt32BE(tfhd.data)&0xffffff,id=bytes.readUInt32BE(tfhd.data+4),track=tracks.get(id);
        if(!track)throw Error('Unknown MP4 track.');
        let cursor=tfhd.data+8;if(flags&1)cursor+=8;if(flags&2)cursor+=4;
        const defaultDuration=flags&8?bytes.readUInt32BE(cursor):defaults.get(id);
        let end=bytes[tfdt.data]===1?Number(bytes.readBigUInt64BE(tfdt.data+4)):bytes.readUInt32BE(tfdt.data+4);
        for(const run of boxes(bytes,traf.data,traf.end).filter(box=>box.type==='trun')){
          const runFlags=bytes.readUInt32BE(run.data)&0xffffff,count=bytes.readUInt32BE(run.data+4);
          let sample=run.data+8;if(runFlags&1)sample+=4;if(runFlags&4)sample+=4;
          const stride=[0x100,0x200,0x400,0x800].filter(flag=>runFlags&flag).length*4;
          if(sample+count*stride>run.end)throw Error('Truncated MP4 sample run.');
          if(!(runFlags&0x100)){
            if(!defaultDuration)throw Error('Missing MP4 sample duration.');
            end+=count*defaultDuration;
          }else for(let index=0;index<count;index++,sample+=stride)end+=bytes.readUInt32BE(sample);
        }
        track.end=Math.max(track.end,end);
      }
    }
    let movieDuration=0;
    if(!movieScale||!tracks.size)throw Error('Invalid MP4 timescale.');
    for(const track of tracks.values()){
      if(!track.scale||!track.end)throw Error('Recording track contains no timed samples.');
      const ticks=Math.ceil(track.end*movieScale/track.scale);
      duration(movie,track.mdhd,track.end,16,24);duration(movie,track.tkhd,ticks,20,28);
      movieDuration=Math.max(movieDuration,ticks);
    }
    duration(movie,mvhd,movieDuration,16,24);
    await file.write(movie,0,movie.length,movieOffset);await file.sync();
    return {durationMs:movieDuration*1000/movieScale};
  }finally{await file.close();}
}
module.exports={finalizeMp4};
