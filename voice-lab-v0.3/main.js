'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const VENV_PY = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
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
let mainWindow;
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
  if (fs.existsSync(VENV_PY)) return { bin: VENV_PY, prefix: [] };
  return systemPython();
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
  await runProcess(py.bin, [...py.prefix, '-m', 'venv', path.join(ROOT, '.venv')], 120000);
  if (!fs.existsSync(VENV_PY)) throw new Error('Could not create the Python environment.');
}

async function installModule(kind) {
  const modules = {
    edge: ['edge-tts'],
    modern: ['winrt-Windows.Media.SpeechSynthesis', 'winrt-Windows.Storage.Streams'],
    recognition: ['vosk']
  };
  if (!Object.prototype.hasOwnProperty.call(modules, kind)) throw new Error('Unknown module');
  await ensureVirtualEnvironment();
  await runProcess(VENV_PY, ['-m', 'pip', 'install', '--disable-pip-version-check', ...modules[kind]], 300000);
  if (kind === 'recognition') {
    const modelDir = path.join(app.getPath('userData'), 'voice-models');
    await job('vosk', 'install-model', { modelDir }, { timeout: 300000 });
  }
  return { installed: kind };
}

function validateEngine(engine) {
  if (!['sapi', 'modern', 'edge'].includes(engine)) throw new Error('Unsupported speech engine.');
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 840,
    minWidth: 790,
    minHeight: 650,
    backgroundColor: '#090e19',
    title: 'C.O.D.Y. Voice Lab v0.3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  await mainWindow.loadFile(path.join(ROOT, 'index.html'));
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const isWindow = wc === mainWindow?.webContents;
    const audioOnly = permission === 'media' &&
      Array.isArray(details?.mediaTypes) &&
      details.mediaTypes.includes('audio') &&
      !details.mediaTypes.includes('video');
    callback(Boolean(isWindow && audioOnly));
  });
  ipcMain.handle('voices:list', async (_e, engine) => {
    validateEngine(engine);
    if (engine === 'edge' && !fs.existsSync(VENV_PY)) {
      return { voices: EDGE_STARTERS, hint: 'Install Edge support to fetch the full online voice list.' };
    }
    try {
      const result = await job(engine, 'voices', {}, { timeout: 30000 });
      if (!result.voices?.length && engine === 'edge') result.voices = EDGE_STARTERS;
      return result;
    } catch (err) {
      if (engine === 'edge') return { voices: EDGE_STARTERS, hint: err.message };
      return { voices: [], error: err.message };
    }
  });
  ipcMain.handle('voices:speak', async (_e, req) => {
    const { engine, voice, text, speed } = req || {};
    validateEngine(engine);
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
      throw new Error('Enter between 1 and ' + MAX_TEXT + ' characters.');
    }
    if (typeof voice !== 'string' || voice.length > 300) throw new Error('Select a valid voice.');
    const safeSpeed = Math.max(0.6, Math.min(1.5, Number(speed) || 1));
    if (speakingProcess) speakingProcess.kill();
    return job(engine, 'speak', { text, voice, speed: safeSpeed }, { audio: true, speech: true });
  });
  ipcMain.handle('voices:install', async (_e, kind) => installModule(kind));
  ipcMain.handle('voices:stop', async () => {
    if (speakingProcess) { speakingProcess.kill(); speakingProcess = null; }
    return { stopped: true };
  });
  ipcMain.handle('mic:transcribe', async (_e, encodedWav) => {
    if (typeof encodedWav !== 'string' || encodedWav.length > 14 * 1024 * 1024) throw new Error('Recording too long.');
    const modelDir = path.join(app.getPath('userData'), 'voice-models');
    return job('vosk', 'transcribe', { wavBase64: encodedWav, modelDir }, { timeout: 120000 });
  });
  await createWindow();
});
app.on('window-all-closed', () => { if (speakingProcess) speakingProcess.kill(); app.quit(); });
