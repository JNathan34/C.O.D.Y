'use strict';
const box=(type,...parts)=>{const body=Buffer.concat(parts),head=Buffer.alloc(8);head.writeUInt32BE(body.length+8);head.write(type,4);return Buffer.concat([head,body]);};
function fixture({version=1,defaultDuration=false}={}){
  function header(type,scale){
    const bytes=Buffer.alloc(type==='tkhd'?96:version?32:24);bytes[0]=version;
    if(type==='tkhd')bytes.writeUInt32BE(1,version?20:12);
    else bytes.writeUInt32BE(scale,version?20:12);
    return box(type,bytes);
  }
  const movie=box('moov',header('mvhd',1000),box('trak',header('tkhd'),box('mdia',header('mdhd',30000))));
  function fragment(start){
    const tfhd=Buffer.alloc(defaultDuration?16:8);tfhd.writeUInt32BE(defaultDuration?8:0);tfhd.writeUInt32BE(1,4);if(defaultDuration)tfhd.writeUInt32BE(30000,8);
    const tfdt=Buffer.alloc(12);tfdt[0]=1;tfdt.writeBigUInt64BE(BigInt(start),4);
    const trun=Buffer.alloc(defaultDuration?8:16);trun.writeUInt32BE(defaultDuration?0:0x100);trun.writeUInt32BE(2,4);if(!defaultDuration){trun.writeUInt32BE(30000,8);trun.writeUInt32BE(30000,12);}
    return box('moof',box('traf',box('tfhd',tfhd),box('tfdt',tfdt),box('trun',trun)));
  }
  return Buffer.concat([box('ftyp',Buffer.from('isom0000isomavc1')),movie,fragment(0),box('mdat',Buffer.from('encoded samples')),fragment(60000),box('mdat',Buffer.from('final samples'))]);
}
module.exports={fixture};
