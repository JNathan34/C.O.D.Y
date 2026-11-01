'use strict';
const {speechText}=require('./speech-text');
/** Cloud-only speech provider. No audio recognition or synthesis runs on the host. */
const fs = require('node:fs');
const path = require('node:path');
const REGIONS = new Set(['uksouth','ukwest','westeurope','northeurope','eastus','eastus2','westus','westus2','westus3','centralus','southcentralus','canadacentral','australiaeast','southeastasia','eastasia','centralindia','swedencentral']);
const VOICES = Object.freeze(['en-GB-SoniaNeural','en-GB-RyanNeural','en-GB-LibbyNeural','en-GB-MaisieNeural','en-US-JennyNeural','en-US-GuyNeural','en-US-AriaNeural']);
const LANGUAGES = new Set(['en-GB','en-US']);
function safeSettings(obj={}){
  const region=String(obj.region||'uksouth').toLowerCase();
  if(!REGIONS.has(region))throw Error('Unsupported Azure Speech region');
  const language=String(obj.language||'en-GB');
  if(!LANGUAGES.has(language))throw Error('Unsupported recognition language');
  const voice=String(obj.voice||'en-GB-SoniaNeural');
  if(!VOICES.includes(voice))throw Error('Unknown cloud voice');
  return {region,language,voice};
}
function xmlEscape(text){return String(text).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));}
function wavHeader(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<44||buffer.length>1_000_100)throw Error('Invalid audio size (maximum 30 seconds)');
  if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE'||buffer.toString('ascii',12,16)!=='fmt ')throw Error('Expected WAV audio');
  if(buffer.readUInt16LE(20)!==1||buffer.readUInt16LE(22)!==1||buffer.readUInt32LE(24)!==16000||buffer.readUInt16LE(34)!==16||buffer.toString('ascii',36,40)!=='data')throw Error('Expected mono 16 kHz 16-bit PCM WAV');
  if(buffer.readUInt32LE(40)!==buffer.length-44)throw Error('Invalid WAV sample length');
  return true;
}
async function cloudRequest(url,headers,body,{fetchImpl=fetch,timeoutMs=18000}={}){
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{method:'POST',headers,body,signal:abort.signal});
    if(!response.ok){const error=(await response.text().catch(()=>'' )).slice(0,240);throw Error(`Azure Speech HTTP ${response.status}${response.status===401||response.status===403?' (check key and region)':''}: ${error}`);}
    return response;
  }catch(e){if(e.name==='AbortError')throw Error('Cloud speech request timed out');throw e;}finally{clearTimeout(timer);}
}
class AzureSpeech{
  constructor({directory,safeStorage,fetchImpl=fetch}={}){
    this.file=path.join(directory,'speech-secret.bin');this.safeStorage=safeStorage;this.fetch=fetchImpl;
    this.config={region:'uksouth',language:'en-GB',voice:'en-GB-SoniaNeural'};
    this.readKey();
  }
  readKey(){try{const blob=fs.readFileSync(this.file);if(this.safeStorage?.isEncryptionAvailable()){const config=JSON.parse(this.safeStorage.decryptString(blob));this.config=safeSettings(config);this.key=String(config.key||'');}}catch{this.key='';}}
  status(){return {...this.config,hasKey:Boolean(this.key),provider:'azure',cloudOnly:true};}
  configure(update={}){
    const config=safeSettings({...this.config,...update});
    let key=typeof update.key==='string'&&update.key.trim()?update.key.trim():this.key||'';
    if(update.clearKey===true)key='';
    if(key&&!/^[\w+\/=\-]{16,256}$/.test(key))throw Error('Invalid Azure Speech key');
    if(!this.safeStorage?.isEncryptionAvailable())throw Error('Secure OS credential storage is unavailable; speech credentials will not be saved');
    const encrypted=this.safeStorage.encryptString(JSON.stringify({...config,key}));
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const tmp=this.file+'.tmp';fs.writeFileSync(tmp,encrypted,{mode:0o600});fs.renameSync(tmp,this.file);
    this.config=config;this.key=key;
    return this.status();
  }
  assertReady(){if(!this.key)throw Error('Configure an Azure Speech F0 resource key under Settings → Voice');}
  async transcribe({base64}={}){
    this.assertReady();if(typeof base64!=='string'||base64.length>1_400_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('Invalid audio payload');
    const wav=Buffer.from(base64,'base64');wavHeader(wav);
    const {region,language}=this.config;
    const url=`https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}&format=simple`;
    const res=await cloudRequest(url,{'Ocp-Apim-Subscription-Key':this.key,'Content-Type':'audio/wav; codecs=audio/pcm; samplerate=16000','Accept':'application/json'},wav,{fetchImpl:this.fetch,timeoutMs:25000});
    const data=await res.json();const text=String(data.DisplayText||'').trim();
    if(data.RecognitionStatus!=='Success'||!text)return {text:'',recognised:false,reason:data.RecognitionStatus||'No speech recognised'};
    return {text:text.slice(0,8000),recognised:true};
  }
  async synthesize({text}={}){
    this.assertReady();if(typeof text!=='string'||!text.trim()||text.length>1200)throw Error('Voice text must contain 1–1200 characters');
    const {region,voice,language}=this.config;
    const ssml=`<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language}"><voice name="${voice}">${xmlEscape(speechText(text))}</voice></speak>`;
    const res=await cloudRequest(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,{'Ocp-Apim-Subscription-Key':this.key,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':'riff-24khz-16bit-mono-pcm','User-Agent':'CODYDesktop'},ssml,{fetchImpl:this.fetch,timeoutMs:22000});
    const data=Buffer.from(await res.arrayBuffer());if(data.length>4_000_000)throw Error('Voice reply too large');
    if(data.toString('ascii',0,4)!=='RIFF')throw Error('Azure returned unexpected voice audio');
    return {base64:data.toString('base64'),mime:'audio/wav'};
  }
}
module.exports={AzureSpeech,REGIONS,VOICES,safeSettings,xmlEscape,wavHeader};
