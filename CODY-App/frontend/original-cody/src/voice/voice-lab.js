'use strict';
// Speech engine adapters extracted from the supplied Voice Lab v0.4.
const fs=require('fs'),os=require('os'),path=require('path');
const {spawn,spawnSync}=require('child_process');
const {selectPython}=require('./python-runtime');
function createVoiceLab(directory, runtimeOptions={}) {
const ROOT = __dirname.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
const runtime = path.join(directory, 'voice-runtime');
const managedPython = path.join(runtime, 'Scripts', 'python.exe');
const VENV_PY = managedPython;
const PS_SCRIPT = path.join(ROOT, 'sapi.ps1');
const PY_SCRIPT = path.join(ROOT, 'speech.py');
const MAX_TEXT = 2000;
const EDGE_STARTERS = [
  { id: 'en-GB-RyanNeural', name: 'Ryan · British male', language: 'en-GB' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia · British female', language: 'en-GB' },
  { id: 'en-GB-LibbyNeural', name: 'Libby · British female', language: 'en-GB' },
  { id: 'en-US-GuyNeural', name: 'Guy · American male', language: 'en-US' },
  { id: 'en-US-JennyNeural', name: 'Jenny · American female', language: 'en-US' }
];

let speakingProcess = null;

function commandWorks(file, args) {
  try {
    const result = spawnSync(file, args, { windowsHide: true, timeout: 4000, encoding: 'utf8' });
    return !result.error && result.status === 0;
  } catch (_) { return false; }
}

function systemPython() {
  if (commandWorks('py', ['-3', '--version'])) return { bin: 'py', prefix: ['-3'] };
  if (commandWorks('python', ['--version'])) return { bin: 'python', prefix: [] };
  throw new Error('Python 3.11+ is required. Install the 64-bit Python version from python.org first.');
}

function pythonInfo() {
  return selectPython(directory,runtimeOptions)||systemPython();
}

function runProcess(bin, args, timeoutMs, trackSpeech = false) {
  return new Promise((resolve, reject) => {
    const cp = spawn(bin, args, {
      cwd: ROOT,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (trackSpeech) speakingProcess = cp;
    let stderr = '';
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      cp.kill();
      settle(new Error('The operation timed out.'));
    }, timeoutMs);
    function settle(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (speakingProcess === cp) speakingProcess = null;
      error ? reject(error) : resolve(value);
    }
    cp.stdout.on('data', d => { stdout += String(d).slice(0, 2048); });
    cp.stderr.on('data', d => { stderr += String(d).slice(0, 6144); });
    cp.once('error', err => settle(err));
    cp.once('close', (code, signal) => {
      if (code === 0) settle(null, { stdout, stderr });
      else settle(new Error((stderr || stdout || ('Process exited: ' + (signal || code))).slice(-2500)));
    });
  });
}

async function job(engine, command, payload, { speech = false, timeout = 120000, audio = false } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cody-voice-'));
  const inputPath = path.join(folder, 'input.json');
  const resultPath = path.join(folder, 'result.json');
  const extension = engine === 'edge' ? 'mp3' : 'wav';
  const audioPath = path.join(folder, 'speech.' + extension);
  const request = { ...payload, resultPath, audioPath };
  fs.writeFileSync(inputPath, JSON.stringify(request), 'utf8');
  try {
    if (engine === 'sapi') {
      await runProcess('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT, command, inputPath],
        timeout, speech);
    } else {
      const py = pythonInfo();
      await runProcess(py.bin, [...py.prefix, PY_SCRIPT, command, engine, inputPath], timeout, speech);
    }
    if (audio) {
      if (!fs.existsSync(audioPath)) throw new Error('The engine did not produce any audio.');
      const bytes = fs.readFileSync(audioPath);
      if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('Invalid audio size.');
      const type = extension === 'mp3' ? 'audio/mpeg' : 'audio/wav';
      return { dataUrl: 'data:' + type + ';base64,' + bytes.toString('base64'), bytes: bytes.length };
    }
    if (!fs.existsSync(resultPath)) throw new Error('The engine did not return a result.');
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    if (result && result.error) throw new Error(result.error);
    return result;
  } finally {
    try { fs.rmSync(folder, { recursive: true, force: true }); } catch (_) {}
  }
}

async function ensureVirtualEnvironment() {
  if (fs.existsSync(VENV_PY)) return;
  const py = systemPython();
  await runProcess(py.bin, [...py.prefix, '-m', 'venv', runtime], 120000);
  if (!fs.existsSync(VENV_PY)) throw new Error('Could not create the Python environment.');
}

async function installModule(kind) {
  const modules = {
    edge: ['edge-tts==7.3.1'],
    modern: ['winrt-Windows.Media.SpeechSynthesis', 'winrt-Windows.Storage.Streams'],
    windows: ['winrt-Windows.Media.SpeechSynthesis', 'winrt-Windows.Storage.Streams']
  };
  if (!Object.prototype.hasOwnProperty.call(modules, kind)) throw new Error('Unknown module');
  const selected=selectPython(directory,runtimeOptions);
  if(selected?.bundled){
    await runProcess(selected.bin,['-c',kind==='edge'?'import edge_tts':'from winrt.windows.media.speechsynthesis import SpeechSynthesizer; from winrt.windows.storage.streams import DataReader'],15000);
    return {installed:kind,bundled:true};
  }
  await ensureVirtualEnvironment();
  await runProcess(VENV_PY, ['-m', 'pip', 'install', '--disable-pip-version-check', ...modules[kind]], 300000);
  return { installed: kind };
}

function validateEngine(engine) {
  if (!['sapi', 'modern', 'edge', 'windows'].includes(engine)) throw new Error('Unsupported speech engine.');
}


async function availableWindowsVoices() {
  const classic = await job('sapi', 'voices', {}, { timeout: 30000 });
  const voices = (classic.voices || []).map(v => ({
    ...v, id: 'sapi:' + v.id,
    name: v.name + ' · Windows Classic',
    source: 'sapi', playable: true
  }));
  const notes = [];
  try {
    const modern = await job('modern', 'voices', {}, { timeout: 30000 });
    for (const v of (modern.voices || [])) {
      voices.push({
        ...v, id: 'modern:' + v.id,
        name: v.name + ' · Windows Modern',
        source: 'modern', playable: true
      });
    }
  } catch (err) {
    notes.push('Install Windows Modern support for more application-accessible voices.');
  }
  for (const v of (classic.narratorVoices || [])) {
    const name = String(v.name || '');
    // Do not pretend Narrator-only voice packages are usable by a public TTS API.
    if (!voices.some(x => x.name.toLowerCase().includes(name.toLowerCase()))) {
      voices.push({
        id: 'narrator:' + String(v.id || name),
        name: name + ' · Narrator-only (not playable in this app)',
        language: v.language || '',
        source: 'narrator', playable: false
      });
    }
  }
  voices.sort((a, b) => Number(b.playable) - Number(a.playable) || a.name.localeCompare(b.name));
  return {
    voices,
    hint: 'Windows voices found: ' + voices.filter(x => x.playable).length +
      ' app-accessible, ' + voices.filter(x => !x.playable).length + ' Narrator-only.' +
      (notes.length ? ' ' + notes.join(' ') : ''),
    notes
  };
}


return {async list(engine) {
    validateEngine(engine);
    if (engine === 'windows') {
      try { return await availableWindowsVoices(); }
      catch (err) { return { voices: [], error: err.message }; }
    }
    try {
      const result = await job(engine, 'voices', {}, { timeout: 30000 });
      if (!result.voices?.length && engine === 'edge') result.voices = EDGE_STARTERS;
      return result;
    } catch (err) {
      if (engine === 'edge') return { voices: EDGE_STARTERS, hint: err.message };
      return { voices: [], error: err.message };
    }
}, async speak(req) {
    let { engine, voice, text, speed } = req || {};
    validateEngine(engine);
    if (engine === 'windows') {
      if (typeof voice !== 'string') throw new Error('Please select a Windows voice.');
      if (voice.startsWith('narrator:')) {
        throw new Error('This natural voice is installed for Narrator but Windows does not expose it for third-party speech synthesis. Choose an accessible voice or Edge Neural.');
      }
      if (voice.startsWith('modern:')) { engine = 'modern'; voice = voice.slice(7); }
      else if (voice.startsWith('sapi:')) { engine = 'sapi'; voice = voice.slice(5); }
      else throw new Error('Unknown Windows voice type. Refresh the voice list.');
    }
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
      throw new Error('Enter between 1 and ' + MAX_TEXT + ' characters.');
    }
    if (typeof voice !== 'string' || voice.length > 300) throw new Error('Select a valid voice.');
    const safeSpeed = Math.max(0.6, Math.min(1.5, Number(speed) || 1));
    if (speakingProcess) speakingProcess.kill();
    return job(engine, 'speak', { text, voice, speed: safeSpeed }, { audio: true, speech: true });
}, async support(engine){
  validateEngine(engine);
  try{
    if(engine==='edge'){
      const py=pythonInfo();
      const result=await runProcess(py.bin,[...py.prefix,'-c','import edge_tts; import importlib.metadata; print(importlib.metadata.version("edge-tts"))'],15000);
      return {available:true,requiresInternet:true,version:result.stdout.trim()};
    }
    const catalog=await availableWindowsVoices();
    return {available:catalog.voices.some(voice=>voice.playable!==false),requiresInternet:false,voices:catalog.voices,reason:catalog.voices.some(voice=>voice.playable!==false)?'':'No application-accessible Windows voices are installed.'};
  }catch(error){
    return {available:false,requiresInternet:engine==='edge',reason:engine==='edge'?'Install Edge Neural support in Voice settings.':error.message};
  }
}, install:installModule, stop(){if(speakingProcess){speakingProcess.kill();speakingProcess=null;}}};
}
module.exports={createVoiceLab};
