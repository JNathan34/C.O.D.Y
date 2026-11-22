'use strict';
(()=>{
 const streamingAndConsoles=[
  [/\bchromecast\b|\bgoogle cast\b/i,'cast','Chromecast','device-cast'],
  [/\bgoogle tv streamer\b/i,'google-tv-streamer','Google TV Streamer','device-streamer'],
  [/\bfire\s*(?:tv\s*)?stick\b/i,'fire-tv-stick','Fire TV Stick','device-stick'],
  // Amazon publishes these build models for Fire TV Stick. AFTMM is shared with soundbars.
  [/\b(?:AFTM|AFTT|AFTSSS?|AFTKA|AFTKM|AFTKRT|AFTMA08C15|AFTCA002|AFTCL001|AFTCR001)\b/i,'fire-tv-stick','Fire TV Stick','device-stick'],
  [/\bfire\s*tv\s*cube\b|\b(?:AFTA|AFTR|AFTGAZL)\b/i,'fire-tv-cube','Fire TV Cube','device-streamer'],
  [/\bfire\s*tv\b|\bfire\s*os\b|\baftmm\b/i,'fire-tv','Fire TV','device-tv'],
  [/\bAFT[A-Z0-9]+\b/,'fire-tv','Fire TV','device-tv'],
  [/\broku\s*tv\b/i,'roku-tv','Roku TV','device-tv'],
  [/\broku\b/i,'roku','Roku','device-streamer'],
  [/\btvos\b|\bapple\s*tv\b/i,'apple-tv','Apple TV','device-streamer'],
  [/\bnvidia\s+shield\b|\bshield\s*(?:android )?tv\b|^shield$/i,'shield','NVIDIA Shield','device-streamer'],
  [/\b(?:mi\s*box|xiaomi\s*tv\s*(?:box|stick)|mi\s*tv\s*stick)\b/i,'xiaomi-streamer','Xiaomi TV','device-streamer'],
  [/\bonn\.?\s+(?:google|android|streaming|4k)\b/i,'onn-streamer','onn. TV','device-streamer'],
  [/\bxbox\s*series\s*x\b/i,'xbox','Xbox Series X','device-xbox'],
  [/\bxbox\s*series\s*s\b/i,'xbox','Xbox Series S','device-xbox'],
  [/\bxbox\s*one\b/i,'xbox','Xbox One','device-xbox'],
  [/\bxbox\b/i,'xbox','Xbox','device-xbox'],
  [/\b(?:playstation\s*5|ps5)\b/i,'playstation','PS5','device-playstation'],
  [/\b(?:playstation\s*4|ps4)\b/i,'playstation','PS4','device-playstation'],
  [/\b(?:playstation\s*3|ps3)\b/i,'playstation','PS3','device-playstation'],
  [/\bplaystation\b/i,'playstation','PlayStation','device-playstation']
 ];
 const televisionBrands=[
  [/\b(?:lg|lge|lg electronics)\b|\blg(?=\d)/i,'lg-tv','LG TV','device-tv'],
  [/\bsamsung\b/i,'samsung-tv','Samsung TV','device-tv'],
  [/\bhisense\b/i,'hisense-tv','Hisense TV','device-tv'],
  [/\b(?:vizio|smartcast)\b/i,'vizio-tv','VIZIO TV','device-tv'],
  [/\b(?:sony|bravia)\b/i,'sony-tv','Sony TV','device-tv'],
  [/\btcl\b/i,'tcl-tv','TCL TV','device-tv'],
  [/\bphilips\b/i,'philips-tv','Philips TV','device-tv'],
  [/\bpanasonic\b/i,'panasonic-tv','Panasonic TV','device-tv'],
  [/\btoshiba\b/i,'toshiba-tv','Toshiba TV','device-tv'],
  [/\bsharp\b/i,'sharp-tv','Sharp TV','device-tv'],
  [/\binsignia\b/i,'insignia-tv','Insignia TV','device-tv'],
  [/\bskyworth\b/i,'skyworth-tv','Skyworth TV','device-tv'],
  [/\b(?:xiaomi|redmi)\b/i,'xiaomi-tv','Xiaomi TV','device-tv'],
  [/\bamazon\b/i,'fire-tv','Fire TV','device-tv'],
  [/\bnvidia\b/i,'shield','NVIDIA Shield','device-streamer'],
  [/\bweb\s*os\s*hub\b/i,'webos-tv','webOS TV','device-tv'],
  [/\b(?:web\s*os|netcast)\b/i,'lg-tv','LG TV','device-tv'],
  [/\b(?:tizen|orsay)\b/i,'samsung-tv','Samsung TV','device-tv'],
  [/\bvidaa\b/i,'vidaa-tv','VIDAA TV','device-tv'],
  [/\bgoogle\s*tv\b/i,'google-tv','Google TV','device-android'],
  [/\bandroid\s*\(?tv\b/i,'android-tv','Android TV','device-android']
 ];
 const browsers=[
  [/\bedge\b|\bedg(?:a|ios)?\b/i,'edge','Microsoft Edge','device-browser'],
  [/\bopera\b|\bopr\b/i,'opera','Opera','device-browser'],
  [/\bbrave\b/i,'brave','Brave','device-browser'],
  [/\bvivaldi\b/i,'vivaldi','Vivaldi','device-browser'],
  [/\bfirefox\b|\bfxios\b/i,'firefox','Firefox','device-browser'],
  [/\bchrome\b|\bcrios\b/i,'chrome','Chrome','device-browser'],
  [/\bchromium\b/i,'chromium','Chromium','device-browser'],
  [/\bsafari\b/i,'safari','Safari','device-browser']
 ];
 const desktopSystems=[
  [/\bwindows\b|\bwin32\b/i,'windows','Windows','device-windows'],
  [/\bmacos(?:x)?\b|\bmac os\b|\bfor mac\b|\bos\s?x\b/i,'mac','Mac','device-desktop'],
  [/\blinux\b/i,'linux','Linux','device-desktop']
 ];
 const fallbackDevices=[
  [/\bipad(?:\b|\d)/i,'ipad','iPad','device-tablet'],
  [/\biphone(?:\b|\d)|\bios\b/i,'ios','iPhone / iOS','device-phone'],
  [/\b(?:fire|android)\b.*\btablet\b|\bkindle fire\b/i,'android-tablet','Android tablet','device-tablet'],
  [/\bandroid\b/i,'android','Android','device-android'],
  [/\b(?:smart\s*tv|television|tv)\b/i,'tv','TV','device-tv'],
  [/\b(?:game |gaming )?console\b/i,'console','Game console','device-console'],
  [/\btablet\b/i,'tablet','Tablet','device-tablet'],
  [/\bphone\b/i,'phone','Phone','device-phone']
 ];
 const tvSignal=/\b(?:tv|television|(?:google|android)\s*tv|oled|qled|web\s*os|netcast|tizen|orsay|vidaa|smartcast|bravia)\b/i;
 const webApp=/\bplex web\b|\bbrowser\b|^web$/i;
 const nativeDesktopApp=/\b(?:plezy|plexamp|plex htpc|plex media player|plex desktop|plex home theater)\b/i;
 const chromiumVariants=new Set(['brave','edge','opera','vivaldi']);

 function find(rules,text,caption=false){
  const match=rules.find(([pattern])=>pattern.test(text));
  if(!match)return null;
  const [,type,label,glyph]=match;
  return {type,label,glyph,...(caption?{caption:label}:{})};
 }
 function identify({platform='',product='',device='',model='',vendor='',player=''}={}){
  const metadata=[platform,product,device,model].join(' ');
  const streaming=find(streamingAndConsoles,metadata,true)||find(streamingAndConsoles,vendor,true);
  if(streaming?.type==='fire-tv'&&/\bfire\s*(?:tv\s*)?stick\b/i.test(player))
   return find(streamingAndConsoles,player,true);
  if(streaming)return streaming;
  const tvContext=tvSignal.test(metadata)||/^(?:lg|lge|samsung|hisense|vizio)$/i.test(String(platform).trim())||
   /^plex for (?:lg|samsung|hisense|vizio)\b/i.test(product);
  if(tvContext){
   const television=find(televisionBrands,metadata+' '+vendor,true);
   if(television)return television;
  }
  const desktop=find(desktopSystems,metadata);
  const webProduct=webApp.test(product);
  const web=webProduct||webApp.test(platform);
  const productSystem=find(desktopSystems,product);
  if(productSystem&&!webProduct)return productSystem;
  const platformSystem=find(desktopSystems,platform);
  if(platformSystem&&!web&&!find(browsers,platform))return platformSystem;
  if(desktop&&!web&&nativeDesktopApp.test(product))return desktop;

  // Player titles can be custom names. Only use them to fill in missing device details.
  if(web||!tvContext){
   const browser=find(browsers,metadata);
   const namedBrowser=web||!desktop?find(browsers,player):null;
   if(web&&['chrome','chromium'].includes(browser?.type)&&chromiumVariants.has(namedBrowser?.type))return namedBrowser;
   if(browser||namedBrowser)return browser||namedBrowser;
  }
  if(web)return {type:'browser',label:'Web browser',glyph:'device-browser'};
  return desktop||find(streamingAndConsoles,player,true)||(tvSignal.test(player)?find(televisionBrands,player,true):null)||
   find(fallbackDevices,metadata+' '+player)||
   {type:'device',label:'Plex player',glyph:'device-desktop'};
 }
 if(typeof module==='object'&&module.exports)module.exports={identify};
 else window.CODYPlexPlayers={identify};
})();
