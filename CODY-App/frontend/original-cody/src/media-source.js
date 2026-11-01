'use strict';
// Defence at the IPC boundary too: do not publish our own speech as playback.
function excludedMediaSource(source){
  const value=String(source||'');
  return /uk\.cody\.|(?:^|[\\/.! _-])c[. _-]*o[. _-]*d[. _-]*y(?:$|[\\/.! _-])|^(?:electron(?:\.exe)?|system\s*sounds?|sndvol(?:\.exe)?)$|(?:^|[\\/.! _-])(?:chatgpt|codex|shellexperiencehost|startmenuexperiencehost)(?:$|[\\/.! _-])/i.test(value);
}
module.exports={excludedMediaSource};
