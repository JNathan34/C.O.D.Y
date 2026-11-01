'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {wavHeader} = require('./azure-speech');
const {createVoiceLab} = require('./voice-lab');
const {verifyModel,verifyAccurateModel}=require('./model-integrity');
const {conditionRecording}=require('./audio-conditioning');
const {repairSpeechCommand}=require('../command-text');
const {speechText}=require('./speech-text');
const {routeRequest}=require('../router');
const {parseDirectAction}=require('../control/parser');
const WHISPER_VOCABULARY='Cody, Firefox, Chrome, Microsoft Edge, eBay, Amazon, Samsung, Galaxy, Ultra, YouTube, Spotify, WhatsApp, Windows.';
const scriptPath = name => path.join(__dirname,'../../windows',name).replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);

class LocalSpeech {
  constructor({directory, runtimeDirectory = path.join(__dirname,'../../runtime/speech'), voiceLab, modelVerifier=verifyModel,accurateModelVerifier=verifyAccurateModel}) {
    this.directory = directory; this.processes = new Set(); this.lab = voiceLab || createVoiceLab(directory); this.catalogs = new Map();
    this.file = path.join(directory, 'local-voice-settings.json');
    this.runtimeDirectory = runtimeDirectory;
    this.modelVerifier=modelVerifier;
    this.accurateModelVerifier=accurateModelVerifier;
    this.settings = {language:'en-GB', recognition:'whisper', engine:'windows', voice:'', speed:1};
    try { this.configure(JSON.parse(fs.readFileSync(this.file, 'utf8')), false); } catch {}
  }
  configure(patch, persist = true) {
    const next = {...this.settings};
    if (patch.recognition !== undefined) { if (!['whisper','windows'].includes(patch.recognition)) throw Error('Invalid recognition provider'); next.recognition = patch.recognition; }
    if (patch.language !== undefined) { if (!/^[a-z]{2}-[A-Z]{2}$/.test(patch.language)) throw Error('Invalid speech language'); next.language = patch.language; }
    if (patch.engine !== undefined) { if (!['windows','edge'].includes(patch.engine)) throw Error('Choose Windows or Edge Neural'); next.engine = patch.engine; }
    if (patch.voice !== undefined) { if (typeof patch.voice !== 'string' || patch.voice.length > 300) throw Error('Invalid voice'); next.voice = patch.voice; }
    if (patch.speed !== undefined) { if (!Number.isFinite(patch.speed) || patch.speed < 0.6 || patch.speed > 1.5) throw Error('Invalid speech speed'); next.speed = patch.speed; }
    this.settings = next;
    if (persist) { fs.mkdirSync(this.directory, {recursive:true}); fs.writeFileSync(this.file, JSON.stringify(next, null, 2)); }
    return {...next, provider:next.recognition, cloudOnly:false};
  }
  async nativeJob(action, audio) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cody-stt-'));
    const inputPath = path.join(folder, 'input.json'), resultPath = path.join(folder, 'result.json'), audioPath = path.join(folder, 'recording.wav');
    try {
      if (audio) fs.writeFileSync(audioPath, audio);
      fs.writeFileSync(inputPath, JSON.stringify({action, audioPath, resultPath, language:this.settings.language}));
      await new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath('transcribe.ps1'),inputPath], {windowsHide:true, stdio:['ignore','ignore','pipe']});
        this.processes.add(child); let stderr = '';
        child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
        const timer = setTimeout(() => child.kill(), 55000);
        child.once('error', error => { clearTimeout(timer); this.processes.delete(child); reject(error); });
        child.once('close', code => { clearTimeout(timer); this.processes.delete(child); code === 0 ? resolve() : reject(Error(stderr || 'Windows speech recognition stopped')); });
      });
      return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    } finally { fs.rmSync(folder, {recursive:true, force:true}); }
  }
  async status() {
    const whisper=this.whisperPaths(),whisperReady=whisper.valid;
    // Windows language packs and speech output are optional when Whisper is
    // selected. A missing recognizer or failed voice catalog must not block it.
    const [nativeResult,outputResult]=await Promise.allSettled([this.nativeJob('status'),this.lab.support(this.settings.engine)]);
    const recognizers=nativeResult.status==='fulfilled'?(nativeResult.value.recognizers||[]):[];
    const output=outputResult.status==='fulfilled'?outputResult.value:{available:false,reason:outputResult.reason.message};
    if(output.voices)this.catalogs.set(this.settings.engine,{voices:output.voices});
    const {voices,...outputStatus}=output;
    const recognitionError=this.settings.recognition==='whisper'?(whisperReady?'':'Speech recognition files are missing or damaged. Use Install recognition to repair them.'):
      nativeResult.status==='rejected'?nativeResult.reason.message:recognizers.some(r=>r.language===this.settings.language)?'':'The Windows speech recognizer for '+this.settings.language+' is not installed. Choose Whisper for the bundled recognizer, or install that Windows speech language pack.';
    return {...this.settings, provider:this.settings.recognition, cloudOnly:false, recognizers, whisperReady,recognitionModel:whisper.label||'Unavailable',output:outputStatus,recognitionError,
      available:this.settings.recognition === 'whisper' ? whisperReady : recognizers.some(r => r.language === this.settings.language)};
  }
  whisperPaths() {
    const candidates=[path.join(this.directory,'speech'),this.runtimeDirectory];
    const binary=candidates.map(runtime=>path.join(runtime,process.arch,'Release','whisper-cli.exe')).find(file=>fs.existsSync(file));
    // Model priority comes before directory priority: a legacy AppData base
    // model must not shadow the improved model shipped by an updated app.
    for(const model of [{file:'ggml-small.en-q5_1.bin',label:'Improved English · small.en Q5',verify:this.accurateModelVerifier},{file:'ggml-base.en.bin',label:'Base English · faster fallback',verify:this.modelVerifier}]){
      for(const runtime of candidates){
        const file=path.join(runtime,model.file);
        if(binary&&model.verify(file))return {binary,model:file,label:model.label,valid:true};
      }
    }
    return {binary:path.join(this.runtimeDirectory,process.arch,'Release','whisper-cli.exe'),model:path.join(this.runtimeDirectory,'ggml-small.en-q5_1.bin'),valid:false};
  }
  async whisper(bytes) {
    const {binary, model,valid} = this.whisperPaths();
    if (!valid) throw Error('Speech recognition files are missing or damaged. Use Microphone → Install recognition to repair them.');
    // Avoid silence hallucinations without sending audio to any service.
    let energy=0;for(let i=44;i<bytes.length;i+=2)energy+=(bytes.readInt16LE(i)/32768)**2;
    if(Math.sqrt(energy/((bytes.length-44)/2))<0.002)return {text:'',confidence:0};
    const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cody-whisper-'));
    const audio=path.join(folder,'recording.wav'), output=path.join(folder,'result');
    try {
      fs.writeFileSync(audio,bytes);
      await new Promise((resolve,reject)=>{
        const threads=String(Math.min(6,Math.max(2,os.availableParallelism?.()||os.cpus().length)));
        const child=spawn(binary,['--model',model,'--file',audio,'--output-json-full','--output-file',output,'--language',this.settings.language.slice(0,2),...(this.settings.language.startsWith('en-')?['--prompt',WHISPER_VOCABULARY]:[]),'--no-gpu','--threads',threads],{windowsHide:true,stdio:['ignore','ignore','pipe']});
        this.processes.add(child);let stderr='';let timedOut=false;
        child.stderr.on('data',data=>{stderr=(stderr+data).slice(-4000);});
        const timer=setTimeout(()=>{timedOut=true;child.kill();},90000);
        child.once('error',error=>{clearTimeout(timer);this.processes.delete(child);reject(error);});
        child.once('close',code=>{clearTimeout(timer);this.processes.delete(child);code===0?resolve():reject(Error(timedOut?'Speech recognition timed out.':stderr||'Recognition cancelled.'));});
      });
      const result=JSON.parse(fs.readFileSync(output+'.json','utf8'));
      const segments=result.transcription||[];
      const text=segments.map(s=>s.text).join(' ').replace(/\[(?:BLANK_AUDIO|SILENCE|MUSIC)\]/gi,'').replace(/\s+/g,' ').trim().replace(/^["“]([^"“”]+)["”]$/,'$1');
      const probabilities=segments.flatMap(s=>s.tokens||[]).filter(t=>!t.text?.startsWith('[_')&&Number.isFinite(t.p)).map(t=>t.p);
      const confidence=probabilities.length?probabilities.reduce((a,b)=>a+b,0)/probabilities.length:0;
      return {text,confidence};
    } finally {fs.rmSync(folder,{recursive:true,force:true});}
  }
  async transcribe({base64} = {}) {
    if (typeof base64 !== 'string' || base64.length > 1400000) throw Error('Invalid recording');
    const bytes=conditionRecording(Buffer.from(base64,'base64'));
    let result,recognitionEngine=this.settings.recognition,verificationAttempted=false;
    let windowsText;
    if(this.settings.recognition==='whisper')result=await this.whisper(bytes);
    else{
      result=await this.nativeJob('transcribe',bytes);
      windowsText=String(result.text||'').trim();
      const repaired=repairSpeechCommand(windowsText);
      // Keep clear short commands instant. Arbitrary low-confidence dictation
      // gets checked against the SAME recording, never guessed from history.
      const clearShortCommand=Boolean(repaired&&(routeRequest(repaired,'chatgpt').kind==='local'||parseDirectAction(repaired)));
      verificationAttempted=!clearShortCommand&&(!windowsText||!Number.isFinite(result.confidence)||result.confidence<.65);
      if(verificationAttempted&&this.whisperPaths().valid){
        try{
          const verified=await this.whisper(bytes);
          if(verified.text?.trim()&&Number.isFinite(verified.confidence)&&verified.confidence>=.55){result=verified;recognitionEngine='whisper';}
        }catch{/* Keep the Windows draft for review if offline verification fails. */}
      }
    }
    const originalText=String(result.text||'').trim(),text=repairSpeechCommand(originalText);
    const needsReview=recognitionEngine==='whisper'?(!Number.isFinite(result.confidence)||result.confidence<.55):verificationAttempted;
    return {...result,text,originalText,corrected:text!==originalText,recognised:Boolean(text),recognitionEngine,windowsText,verifiedWithWhisper:this.settings.recognition==='windows'&&recognitionEngine==='whisper',needsReview,
      ...(needsReview?{reviewReason:'I could not hear that clearly. Please say it again or check the transcript before sending.'}:{})};
  }
  async voices(engine) { const catalog=await this.lab.list(engine);this.catalogs.set(engine,catalog);return catalog; }
  install(engine) {
    if(engine!=='recognition')return this.lab.install(engine);
    return new Promise((resolve,reject)=>{
      const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath('setup-speech.ps1'),'-Architecture',process.arch,'-RuntimeDirectory',path.join(this.directory,'speech'),'-BundledRuntimeDirectory',this.runtimeDirectory],{windowsHide:true,stdio:['ignore','ignore','pipe']});
      this.processes.add(child);let stderr='';child.stderr.on('data',d=>{stderr=(stderr+d).slice(-3000);});
      child.once('error',error=>{this.processes.delete(child);reject(error);});
      child.once('close',code=>{this.processes.delete(child);code===0?resolve({installed:true}):reject(Error(stderr||'Speech installation failed.'));});
    });
  }
  async synthesize({text}) {
    const engine = this.settings.engine; let voice = this.settings.voice;
    if (!voice) {
      const catalog = this.catalogs.get(engine) || await this.voices(engine);
      voice = catalog.voices.find(v => v.playable !== false && v.language === this.settings.language)?.id || catalog.voices.find(v => v.playable !== false)?.id;
    }
    const result = await this.lab.speak({engine, voice, text:speechText(text), speed:this.settings.speed});
    const match = result.dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    return {mime:match[1], base64:match[2]};
  }
  cancel() { for (const child of this.processes) child.kill(); this.lab.stop(); }
}
module.exports = {LocalSpeech};
