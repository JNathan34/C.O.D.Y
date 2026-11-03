'use strict';
const {EventEmitter}=require('node:events'),os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process');
const {commandText}=require('./command-text');
const {Weather,parseWeatherRequest}=require('./weather');
const METRICS=['cpu','ram','gpu','fps','wifi','wifiDetails','wifiSpeed','speedtest','clock','weather'];
const canonicalMetric=id=>({cpuTemp:'cpu',gpuTemp:'gpu'})[id]||id;
const aliases={cpu:'cpu','cpu usage':'cpu',processor:'cpu','processor usage':'cpu',temp:'cpuTemp',temperature:'cpuTemp','cpu temp':'cpuTemp','cpu temperature':'cpuTemp',ram:'ram',memory:'ram','ram usage':'ram','memory usage':'ram',gpu:'gpu','gpu usage':'gpu','gpu temp':'gpuTemp','gpu temperature':'gpuTemp',fps:'fps','frame rate':'fps',wifi:'wifi','wi fi':'wifi','wifi details':'wifiDetails','wi fi details':'wifiDetails','wifi speed':'wifiSpeed','wi fi speed':'wifiSpeed','network speed':'wifiSpeed','speed test':'speedtest'};
function monitorCommand(input){
  const explicitDisplay=/^(?:show|display|monitor|keep showing|pin)(?: me)?\s/i.test(commandText(input,{preserveShow:true}));
  let text=commandText(input).toLowerCase().replace(/[’']/g,'').replace(/wi-fi/g,'wifi').trim();
  if(explicitDisplay)text=text.replace(/\s+(?:(?:24\s*\/\s*7|24\s+7|all the time|permanently|always)|(?:on|in) (?:the |my )?island)$/,'');
  text=text.replace(/\bc[.\s-]*p[.\s-]*[uv]\b\.?/g,'cpu').replace(/\bg[.\s-]*p[.\s-]*u\b\.?/g,'gpu').replace(/\br[.\s-]*a[.\s-]*m\b\.?/g,'ram');
  // Repair the observed mixed-language dictation of "hide CPU usage".
  if(/\bcpu\b/.test(text))text=text.replace(/^(?:های|هاید)\s+(?:its?\s+)?/u,'hide ').replace(/یوسش/gu,'usage');
  if(/^(?:clear|reset) (?:the |my )?island$|^(?:stop|hide|clear) (?:all )?(?:monitors|monitoring|stats|statistics)$/.test(text))return {action:'clear'};
  if(/^(?:(?:run|start|do|perform) )?(?:a |the |my )?(?:(?:wifi|wi fi|internet|network) )?speed ?test$|^test (?:my |the )?(?:wifi|internet) speed$/.test(text))return {action:'speedtest'};
  let action='show';const hide=/^(?:stop (?:showing|monitoring|displaying)|(?:dont|do not) (?:show|display)|hide|remove|clear|turn off) (?:my |the )?(.+)$/.exec(text);
  if(hide){action='hide';text=hide[1].replace(/ (?:from |in |on )?(?:the |my )?island$/,'').replace(/ (?:anymore|please)$/,'').replace(/ (?:monitor|indicator|counter|stats|display)$/,'');}else text=text.replace(/^(?:show|display|monitor|keep showing|pin)(?: me)? (?:my |the )?/,'').replace(/^(?:my|the) /,'');
  const parts=text.split(/\s+(?:and|plus)\s+|\s*,\s*/);let temperatureGroup='cpu';
  let weatherLocation;
  const metrics=parts.map(part=>{
    const key=part.trim().replace(/^(?:my|the) /,'');
    if(action==='hide'||explicitDisplay){
      if(key==='clock'||key==='time'||key==='current time')return 'clock';
      const weather=parseWeatherRequest(key);
      if(weather){if(weather.location||/\b(?:here|near me|outside|my location)$/.test(key))weatherLocation=weather.location;return 'weather';}
    }
    if(key==='temp'||key==='temperature')return temperatureGroup;const id=canonicalMetric(aliases[key]);if(id==='cpu'||id==='gpu')temperatureGroup=id;return id;
  });
  if(!metrics.length||metrics.some(metric=>!metric))return null;return {action,metrics:[...new Set(metrics)],...(weatherLocation!==undefined?{weatherLocation}:{})};
}
function cpuSample(){const cores=os.cpus();return {idle:cores.reduce((sum,core)=>sum+core.times.idle,0),total:cores.reduce((sum,core)=>sum+Object.values(core.times).reduce((a,b)=>a+b,0),0)};}
class IslandMonitors extends EventEmitter{
  constructor({settingsFile,fetcher=fetch,readWindows,now=Date.now,fpsProvider=null,weather}={}){
    super();Object.assign(this,{settingsFile,fetcher,now,fpsProvider});this.selected=new Set();this.previousCpu=cpuSample();this.data={};this.values={};this.lastWifi=null;this.readWindows=readWindows||(()=>new Promise((resolve,reject)=>{this.child=execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'../windows/telemetry-snapshot.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep),'-Metrics',[...this.selected].join(',')],{windowsHide:true,timeout:12000,maxBuffer:200000},(error,stdout)=>{this.child=null;if(error)reject(Error('Windows sensor data is unavailable'));else{try{resolve(JSON.parse(stdout));}catch{reject(Error('Windows sensor data is unavailable'));}}});}));
    this.weather=weather||new Weather({fetcher,now});this.weatherLocation='';this.weatherGeneration=0;this.weatherNextUpdate=0;
    this.clockFormat=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    this.clockDateFormat=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short'});
    if(settingsFile){try{const saved=JSON.parse(fs.readFileSync(settingsFile,'utf8'));if(typeof saved.weatherLocation==='string'&&saved.weatherLocation.length<=100)this.weatherLocation=saved.weatherLocation;for(const metric of saved.metrics||[]){const id=canonicalMetric(metric);if(METRICS.includes(id))this.selected.add(id);}if(saved.speedtest&&typeof saved.speedtest.text==='string'&&typeof saved.speedtest.detail==='string'){this.values.speedtest={text:saved.speedtest.text.slice(0,100),detail:saved.speedtest.detail.slice(0,300),tooltip:saved.speedtest.tooltip?.slice(0,500)};if(/Testing|Measuring/.test(this.values.speedtest.detail))this.values.speedtest.detail='Previous test was interrupted; run it again.';}if(saved.metrics?.some(id=>id!==canonicalMetric(id)))this.save();}catch{}}
    this.timer=setInterval(()=>this.sample(),1000);this.timer.unref();this.sample();
  }
  match(input){return monitorCommand(input);}
  save(){if(this.settingsFile){fs.mkdirSync(path.dirname(this.settingsFile),{recursive:true});fs.writeFileSync(this.settingsFile+'.tmp',JSON.stringify({metrics:[...this.selected],speedtest:this.values.speedtest,weatherLocation:this.weatherLocation}));fs.renameSync(this.settingsFile+'.tmp',this.settingsFile);}}
  snapshot(){return {active:this.selected.size>0,metrics:[...this.selected],items:[...this.selected].map(id=>({id,...(this.values[id]||{text:id,detail:'Loading…'})})),updatedAt:this.now()};}
  publish(){this.emit('change',this.snapshot());}
  async execute(route){
    if(route.metrics){route={...route,metrics:[...new Set(route.metrics.map(canonicalMetric))]};if(route.metrics.some(id=>!METRICS.includes(id)))throw Error('Unknown Island monitor.');}
    if(route.weatherLocation!==undefined&&(typeof route.weatherLocation!=='string'||route.weatherLocation.length>100||!route.metrics?.includes('weather')))throw Error('Invalid weather location.');
    if(route.action==='clear'){this.selected.clear();this.weatherGeneration++;this.weatherPending=null;this.speedAbort?.abort();this.save();this.publish();return {reply:'Island monitors cleared.',confirmation:'Done.'};}
    if(route.action==='hide'){for(const metric of route.metrics)this.selected.delete(metric);if(route.metrics.includes('weather')){this.weatherGeneration++;this.weatherPending=null;}if(!this.selected.has('speedtest'))this.speedAbort?.abort();this.save();this.publish();return {reply:'Stopped showing '+route.metrics.map(id=>id.replace(/([A-Z])/g,' $1').toLowerCase()).join(' and ')+'.',confirmation:'Done.'};}
    if(route.action==='speedtest'){
      if(this.speedRunning)return {reply:'The Wi-Fi speed test is already running.'};
      this.selected.add('speedtest');this.save();this.values.speedtest={text:'Speed test',detail:'Testing…'};this.publish();void this.speedTest();return {reply:'Wi-Fi speed test started. Results will stay in the Island.',confirmation:'Done.'};
    }
    if(route.metrics.includes('weather')){
      const location=route.weatherLocation??this.weatherLocation;
      if(location!==this.weatherLocation){this.weatherLocation=location;this.weatherGeneration++;this.weatherPending=null;delete this.values.weather;}
      this.weatherNextUpdate=0;
    }
    for(const metric of route.metrics)this.selected.add(metric);this.save();this.sample();return {reply:'Showing '+route.metrics.map(id=>id.replace(/([A-Z])/g,' $1').toLowerCase()).join(' and ')+(route.metrics.includes('weather')&&this.weatherLocation?' for '+this.weatherLocation:'')+' in the Island.',confirmation:'Done.'};
  }
  sample(){
    if(!this.selected.size)return;
    if(this.selected.has('clock')){const date=new Date(this.now());this.values.clock={text:this.clockFormat.format(date),detail:this.clockDateFormat.format(date),icon:'clock',tooltip:date.toLocaleString()+' · Local time'};}
    if(this.selected.has('weather')){this.values.weather??={text:'Weather',detail:'Loading…',icon:'cloud'};void this.refreshWeather();}
    const cpu=cpuSample(),delta=cpu.total-this.previousCpu.total;this.cpu=delta>0?Math.max(0,Math.min(100,Math.round(100*(1-(cpu.idle-this.previousCpu.idle)/delta)))):this.cpu??null;this.previousCpu=cpu;
    const totalMemory=os.totalmem(),usedMemory=totalMemory-os.freemem(),percent=Math.round(100*usedMemory/totalMemory),ramUsed=usedMemory/2**30,ramTotal=totalMemory/2**30;
    const stale=this.windowsUpdatedAt&&this.now()-this.windowsUpdatedAt>20000;
    const tempText=value=>Number.isFinite(value)&&!stale?'Temp '+Math.round(value)+'°C':'';
    this.values.cpu={text:'CPU '+(this.cpu===null?'N/A':this.cpu+'%'),detail:tempText(this.data.cpuTemp),tooltip:(os.cpus()[0]?.model||'Processor')+' · '+(Number.isFinite(this.data.cpuTemp)&&!stale?'Temperature '+this.data.cpuTemp+'°C':'Temperature unavailable: no current supported sensor reading')};
    this.values.ram={text:'RAM '+percent+'%',detail:ramUsed.toFixed(1)+' / '+ramTotal.toFixed(1)+' GB'};
    const temperature=(label,value)=>({text:label+' '+(Number.isFinite(value)?Math.round(value)+'°C':'temp N/A'),detail:Number.isFinite(value)?'Live temperature':'Unavailable: no supported temperature sensor provider'});
    this.values.cpuTemp=temperature('CPU',this.data.cpuTemp);this.values.gpuTemp=temperature('GPU',this.data.gpuTemp);
    this.values.gpu={text:'GPU '+(Number.isFinite(this.data.gpu)&&!stale?Math.round(Math.max(0,Math.min(100,this.data.gpu)))+'%':'N/A'),detail:tempText(this.data.gpuTemp),tooltip:(this.data.gpuName||'Graphics processor')+' · '+(this.sensorError||(!Number.isFinite(this.data.gpu)||stale?'Usage counter unavailable':'Live usage'))+' · '+(Number.isFinite(this.data.gpuTemp)&&!stale?'Temperature '+this.data.gpuTemp+'°C':'Temperature sensor unavailable')};
    let fps=null;try{fps=this.fpsProvider?.();}catch{}const validFps=Number.isFinite(fps)&&fps>=0;this.values.fps={text:'FPS '+(validFps?Math.round(fps):'N/A'),detail:validFps?'Live frame rate':'No FPS provider',tooltip:validFps?'Measured application frame rate':'Unavailable: no supported FPS provider is running'};
    const wifi=stale?null:this.data.wifi;
    const wifiMissing=wifi?.connected===false?'Wi-Fi offline':'Wi-Fi N/A';
    this.values.wifi={text:wifi?.connected?(wifi.ssid||'Wi-Fi connected'):wifiMissing,detail:wifi?.connected?`${wifi.signal!=null?wifi.signal+'% · ':''}${wifi.radio||'Connected'}`:'No current Wi-Fi reading',tooltip:wifi?.error||wifi?.adapter||'Wi-Fi connection status'};
    const link=value=>Number(value)>0?(Number(value)>=1000?(Number(value)/1000).toFixed(1)+'G':Math.round(Number(value))+'M'):'?';
    this.values.wifiDetails={text:wifi?.connected&&wifi.signal!=null?'Wi-Fi '+wifi.signal+'%':wifi?.connected?'Wi-Fi details':wifiMissing,detail:wifi?.connected?'RX '+link(wifi.receiveMbps||wifi.linkMbps)+' · TX '+link(wifi.transmitMbps):'No current Wi-Fi reading',tooltip:wifi?.connected?[wifi.ssid,wifi.radio,'Receive link '+(wifi.receiveMbps||wifi.linkMbps||'?')+' Mbps','Transmit link '+(wifi.transmitMbps||'?')+' Mbps'].filter(Boolean).join(' · '):'Wi-Fi connection details unavailable'};
    this.values.wifiSpeed={text:wifi?.connected?(Number.isFinite(this.rx)?'↓'+this.rx.toFixed(1)+' Mbps':'Wi-Fi speed'):wifiMissing,detail:wifi?.connected?(Number.isFinite(this.tx)?'↑'+this.tx.toFixed(1)+' Mbps':'Measuring…'):'No current Wi-Fi reading',tooltip:'Measured live download/upload traffic, not maximum Internet speed'};
    this.publish();
    if(!this.pending&&this.now()-(this.lastWindows||0)>=5000&&[...this.selected].some(id=>!['ram','fps','speedtest','clock','weather'].includes(id))){
      this.pending=true;this.lastWindows=this.now();void this.readWindows().then(data=>{
        this.data=data;this.windowsUpdatedAt=this.now();this.sensorError=null;const current=data.wifi,previous=this.lastWifi,time=this.now();
        if(current?.connected&&previous&&current.adapter===previous.adapter&&time>previous.time&&current.received>=previous.received&&current.sent>=previous.sent){this.rx=(current.received-previous.received)*8/(time-previous.time)/1000;this.tx=(current.sent-previous.sent)*8/(time-previous.time)/1000;}else{this.rx=null;this.tx=null;}
        if(current?.connected)this.lastWifi={...current,time};else{this.lastWifi=null;this.rx=null;this.tx=null;}
      }).catch(error=>{this.sensorError=error.message;}).finally(()=>{this.pending=false;if(!this.closed)this.sample();});
    }
  }
  async refreshWeather(){
    if(this.closed||!this.selected.has('weather')||this.weatherPending||this.now()<this.weatherNextUpdate)return;
    const request=this.weatherPending={generation:this.weatherGeneration,location:this.weatherLocation};
    this.weatherNextUpdate=this.now()+5*60*1000;
    const current=()=>!this.closed&&this.selected.has('weather')&&request.generation===this.weatherGeneration;
    try{
      const result=await this.weather.current(request.location);
      if(!result?.card||typeof result.card.text!=='string'||typeof result.card.detail!=='string')throw Error('Current weather data is unavailable.');
      if(current()){this.weatherNextUpdate=this.now()+5*60*1000;this.values.weather={...result.card,tooltip:(result.card.tooltip||result.reply||'')+' Updated '+new Date(this.now()).toLocaleTimeString()+'.'};this.publish();}
    }catch(error){if(current()){this.values.weather={text:'Weather unavailable',detail:request.location||'Try a named city',icon:'cloud-off',tooltip:error.message||'Current weather data is unavailable.'};this.weatherNextUpdate=this.now()+60*1000;this.publish();}}
    finally{if(this.weatherPending===request)this.weatherPending=null;}
  }
  async speedTest(){
    this.speedRunning=true;const controller=this.speedAbort=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
    const request=async(url,options={})=>{const response=await this.fetcher(url,{...options,cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('Speed test service unavailable');return response;};
    try{
      const pingStart=performance.now();await (await request('https://speed.cloudflare.com/__down?bytes=0')).arrayBuffer();const latency=performance.now()-pingStart;
      this.values.speedtest={text:'Speed test',detail:'Measuring download…'};this.publish();
      let start=performance.now();const down=await request('https://speed.cloudflare.com/__down?bytes=20000000');let bytes=0;for await(const chunk of down.body)bytes+=chunk.byteLength;const download=bytes*8/(performance.now()-start)/1000;
      this.values.speedtest={text:'Speed test',detail:'Measuring upload…'};this.publish();
      const uploadBytes=4000000;start=performance.now();await (await request('https://speed.cloudflare.com/__up',{method:'POST',body:new Uint8Array(uploadBytes),headers:{'Content-Type':'application/octet-stream'}})).arrayBuffer();const upload=uploadBytes*8/(performance.now()-start)/1000;
      this.values.speedtest={text:'↓'+download.toFixed(1)+' Mbps',detail:'↑'+upload.toFixed(1)+' Mbps',tooltip:`${Math.round(latency)} ms latency · approximate Internet speed via Cloudflare`};
    }catch(error){this.values.speedtest={text:'Speed test',detail:controller.signal.aborted?'Stopped or timed out':error.message};}
    finally{clearTimeout(timer);this.speedRunning=false;this.speedAbort=null;this.save();this.publish();}
  }
  close(){this.closed=true;this.weatherGeneration++;clearInterval(this.timer);this.speedAbort?.abort();this.child?.kill();}
}
module.exports={IslandMonitors,monitorCommand};
