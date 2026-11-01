'use strict';
(()=>{
  function imageData(value){return typeof value==='string'&&value.length<=100000&&/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(value);}
  function candidates(media){
    const images=[];
    if(imageData(media.artwork))images.push(media.artwork);
    const identity=[media.service,media.app,media.source].filter(Boolean).join(' ').toLowerCase();
    if(identity.includes('youtube'))images.push('assets/media/youtube.svg');
    else if(identity.includes('spotify'))images.push('assets/media/spotify.svg');
    if(imageData(media.appIcon))images.push(media.appIcon);
    images.push('assets/media/app-window.svg');
    return [...new Set(images)];
  }
  if(typeof module!=='undefined')module.exports={candidates,imageData};
  if(typeof window!=='undefined')window.CODYMediaArt={candidates};
})();
