'use strict';

const $ = id => document.getElementById(id);
const ui = {
  engine: $('engine'), voice: $('voice'), text: $('speechText'),
  speed: $('speed'), volume: $('volume'), status: $('status'), detail: $('detail'),
  install: $('installEngine'), installMic: $('installMic'),
  micButton: $('micButton'), micHeading: $('micHeading'), micHelp: $('micHelp'),
  transcript: $('transcript'), meter: $('micMeter').firstElementChild,
  visualiser: $('visualiser'), speak: $('speakBtn'), stop: $('stopBtn'),
  replay: $('replayBtn')
};

let playback = null;
let lastAudioUrl = null;
let operationToken = 0;
let recording = null;
let loadingVoices = 0;
let voiceCatalog = [];
let dictationActive = false;

function notify(text, isError = false) {
  ui.status.textContent = text;
  ui.status.parentElement.classList.toggle('error', Boolean(isError));
}
function busySpeaking(on) {
  ui.visualiser.classList.toggle('active', Boolean(on));
  ui.speak.disabled = Boolean(on) || ui.voice.selectedOptions[0]?.dataset?.playable === 'false';
}
function noteForEngine() {
  const e = ui.engine.value;
  if (e === 'edge') {
    $('engineNote').textContent = 'Online neural voices. First install Python support.';
    ui.install.hidden = false;
    ui.install.textContent = 'Install support';
  } else if (e === 'windows') {
    $('engineNote').textContent = 'Merged Classic + Modern voices; Narrator-only voices may be detected but cannot always be used to speak.';
    ui.install.hidden = false;
    ui.install.textContent = 'Enable Modern support';
  } else if (e === 'modern') {
    $('engineNote').textContent = 'Installed Microsoft voices exposed via Windows modern speech API.';
    ui.install.hidden = false;
  } else {
    $('engineNote').textContent = 'Installed classic Windows SAPI voices. Works without Python.';
    ui.install.hidden = true;
  }
}

async function loadVoices() {
  const token = ++loadingVoices;
  const engine = ui.engine.value;
  noteForEngine();
  voiceCatalog = [];
  ui.voice.replaceChildren(new Option('Loading installed voices…', ''));
  notify('Checking available voices…');
  try {
    const data = await window.cody.listVoices(engine);
    if (token !== loadingVoices) return;
    const voices = Array.isArray(data.voices) ? data.voices : [];
    voiceCatalog = voices;
    ui.voice.replaceChildren();
    if (!voices.length) {
      ui.voice.add(new Option('No voices available — install support or refresh', ''));
      notify(data.error || 'No available voices reported by this engine.', true);
      return;
    }
    const saved = localStorage.getItem('cody-voice:' + engine);
    for (const v of voices) {
      const label = v.name || v.id;
      const option = new Option(label, v.id);
      option.dataset.playable = v.playable === false ? 'false' : 'true';
      ui.voice.add(option);
    }
    const preferred = saved || (engine === 'edge' ? 'en-GB-RyanNeural' : '');
    if (preferred && voices.some(v => v.id === preferred)) ui.voice.value = preferred;
    else {
      const firstAvailable = voices.find(v => v.playable !== false);
      if (firstAvailable) ui.voice.value = firstAvailable.id;
    }
    updateVoiceExplanation();
    notify(data.hint ? data.hint : 'Found ' + voices.length + ' available voices.');
  } catch (e) { notify('Could not get voices: ' + e.message, true); }
}

function updateVoiceExplanation() {
  const selected = voiceCatalog.find(v => v.id === ui.voice.value);
  const output = $('voiceExplain');
  const isNarratorOnly = selected && selected.playable === false;
  if (isNarratorOnly) {
    output.textContent = 'Installed for Narrator, but this voice is NOT exposed to this app for synthesis. Select an available Windows voice or try the Edge Neural equivalent online.';
    ui.speak.disabled = true;
  } else {
    output.textContent = selected?.source === 'sapi'
      ? 'Playable locally through Windows Classic (SAPI).'
      : selected?.source === 'modern'
      ? 'Playable locally through Windows Modern (WinRT).'
      : 'This voice can be tested with the selected engine.';
    ui.speak.disabled = false;
  }
}

function stopAudio() {
  ++operationToken;
  if (playback) { playback.pause(); playback.src = ''; playback = null; }
  busySpeaking(false);
  window.cody.stop().catch(() => {});
}

async function playUrl(url, token) {
  const audio = new Audio(url);
  playback = audio;
  audio.volume = Number(ui.volume.value) / 100;
  audio.onended = () => {
    if (token === operationToken) {
      busySpeaking(false);
      notify('Finished speaking.');
    }
  };
  audio.onerror = () => {
    if (token === operationToken) {
      busySpeaking(false);
      notify('Playback failed. Check your audio output.', true);
    }
  };
  await audio.play();
}

async function speak() {
  const text = ui.text.value.trim();
  if (!text) { notify('Type something for C.O.D.Y. to say.', true); return; }
  if (ui.voice.selectedOptions[0]?.dataset?.playable === 'false') {
    notify('That voice belongs to Narrator and cannot be spoken by the public Windows TTS API.', true);
    return;
  }
  stopAudio();
  const token = operationToken;
  busySpeaking(true);
  notify('Generating speech…');
  try {
    const result = await window.cody.speak({
      engine: ui.engine.value, voice: ui.voice.value,
      text, speed: Number(ui.speed.value)
    });
    if (token !== operationToken) return;
    lastAudioUrl = result.dataUrl;
    notify('Playing voice…');
    await playUrl(lastAudioUrl, token);
  } catch (e) {
    if (token === operationToken) {
      busySpeaking(false);
      notify('Speech failed: ' + e.message, true);
    }
  }
}

function updateRanges() {
  $('speedValue').textContent = Number(ui.speed.value).toFixed(2) + '×';
  $('volumeValue').textContent = ui.volume.value + '%';
  if (playback) playback.volume = Number(ui.volume.value) / 100;
}

ui.engine.addEventListener('change', () => {
  stopAudio();
  localStorage.setItem('cody-engine', ui.engine.value);
  loadVoices();
});
ui.voice.addEventListener('change', () => {
  localStorage.setItem('cody-voice:' + ui.engine.value, ui.voice.value);
  updateVoiceExplanation();
});
ui.speed.addEventListener('input', updateRanges);
ui.volume.addEventListener('input', updateRanges);
$('refreshVoices').addEventListener('click', loadVoices);
ui.speak.addEventListener('click', speak);
ui.stop.addEventListener('click', () => { stopAudio(); notify('Stopped.'); });
ui.replay.addEventListener('click', async () => {
  if (!lastAudioUrl) { notify('Speak some text first.', true); return; }
  stopAudio();
  const token = operationToken;
  busySpeaking(true);
  notify('Replaying last generated audio…');
  try { await playUrl(lastAudioUrl, token); }
  catch (e) { busySpeaking(false); notify('Replay failed: ' + e.message, true); }
});

ui.install.addEventListener('click', async () => {
  const kind = ui.engine.value;
  if (kind === 'sapi') return;
  ui.install.disabled = true;
  notify('Installing ' + (kind === 'edge' ? 'Edge Neural' : 'Windows Modern') + ' support…');
  try {
    await window.cody.install(kind);
    notify('Support installed. Refreshing voices…');
    await loadVoices();
  } catch (e) { notify('Install failed: ' + e.message, true); }
  finally { ui.install.disabled = false; }
});


// Windows' built-in Win + H dictation works without the unsupported Vosk
// wheel on some Windows ARM64/Python configurations. The user owns the
// native dictation toolbar and its microphone permissions.
ui.installMic.addEventListener('click', () => {
  notify('Click the microphone button, then press Windows + H to start voice typing. Speak into the editable transcript field, stop dictation in the Windows toolbar, then click the microphone again to finish.');
});

function setDictationState(active) {
  dictationActive = active;
  ui.micButton.classList.toggle('recording', active);
  ui.micButton.setAttribute('aria-label', active ? 'Finish dictation' : 'Start dictation');
  ui.micHeading.textContent = active ? 'Voice typing ready' : 'Windows voice typing';
  ui.micHelp.textContent = active
    ? 'Press Win + H and speak. Stop in the Windows toolbar, then click this button again.'
    : 'Click the mic, press Win + H, speak, then click the mic again to finish.';
}

ui.micButton.addEventListener('click', async () => {
  if (!dictationActive) {
    stopAudio();
    setDictationState(true);
    ui.transcript.focus();
    notify('Transcript field focused. Press Win + H to begin Windows voice typing (internet required).');
    return;
  }
  setDictationState(false);
  const spoken = ui.transcript.value.trim();
  if (!spoken) {
    notify('No words detected yet. Press Win + H while the transcript field is focused.', true);
    return;
  }
  notify('Transcript ready: ' + spoken);
  if ($('speakBack').checked) {
    ui.text.value = spoken;
    await speak();
  }
});

$('copyTranscript').addEventListener('click', async () => {
  if (!ui.transcript.value) return;
  try {
    await navigator.clipboard.writeText(ui.transcript.value);
    notify('Transcript copied.');
  } catch (e) { notify('Could not copy: ' + e.message, true); }
});
$('useTranscript').addEventListener('click', () => {
  ui.text.value = ui.transcript.value;
  notify('Transcript copied into the speech text field.');
});

// Existing v0.3 users previously defaulted to Modern's short list;
 // migrate that saved selection to the merged Windows catalogue.
const savedEngine = localStorage.getItem('cody-engine');
ui.engine.value = savedEngine === 'modern' ? 'windows'
  : ['edge','sapi','windows'].includes(savedEngine) ? savedEngine : 'windows';
updateRanges();
loadVoices();
