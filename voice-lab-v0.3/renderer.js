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

function notify(text, isError = false) {
  ui.status.textContent = text;
  ui.status.parentElement.classList.toggle('error', Boolean(isError));
}
function busySpeaking(on) {
  ui.visualiser.classList.toggle('active', Boolean(on));
  ui.speak.disabled = Boolean(on);
}
function noteForEngine() {
  const e = ui.engine.value;
  if (e === 'edge') {
    $('engineNote').textContent = 'Online neural voices. First install Python support.';
    ui.install.hidden = false;
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
  ui.voice.replaceChildren(new Option('Loading installed voices…', ''));
  notify('Checking available voices…');
  try {
    const data = await window.cody.listVoices(engine);
    if (token !== loadingVoices) return;
    const voices = Array.isArray(data.voices) ? data.voices : [];
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
      ui.voice.add(option);
    }
    const preferred = saved || (engine === 'edge' ? 'en-GB-RyanNeural' : '');
    if (preferred && voices.some(v => v.id === preferred)) ui.voice.value = preferred;
    notify(data.hint ? data.hint : 'Found ' + voices.length + ' available voices.');
  } catch (e) { notify('Could not get voices: ' + e.message, true); }
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
ui.voice.addEventListener('change', () => localStorage.setItem('cody-voice:' + ui.engine.value, ui.voice.value));
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

ui.installMic.addEventListener('click', async () => {
  ui.installMic.disabled = true;
  notify('Installing offline recognition and downloading its English model…');
  try {
    await window.cody.install('recognition');
    notify('Microphone recognition installed. Click the microphone to speak.');
    ui.installMic.textContent = 'Installed';
  } catch (e) { notify('Recognition install failed: ' + e.message, true); }
  finally { ui.installMic.disabled = false; }
});

function combineSamples(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(total);
  let start = 0;
  for (const chunk of chunks) { samples.set(chunk, start); start += chunk.length; }
  return samples;
}

function resample(samples, fromRate, toRate = 16000) {
  const count = Math.round(samples.length * toRate / fromRate);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const from = i * fromRate / toRate;
    const left = Math.floor(from), right = Math.min(left + 1, samples.length - 1);
    const fraction = from - left;
    out[i] = (samples[left] || 0) * (1 - fraction) + (samples[right] || 0) * fraction;
  }
  return out;
}

function wavBytes(samples, sampleRate = 16000) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  function ascii(at, str) { for (let i = 0; i < str.length; i++) view.setUint8(at + i, str.charCodeAt(i)); }
  ascii(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return new Uint8Array(bytes);
}

function bytesBase64(bytes) {
  let binary = '';
  const block = 0x2000;
  for (let i = 0; i < bytes.length; i += block) {
    binary += String.fromCharCode(...bytes.subarray(i, i + block));
  }
  return btoa(binary);
}

function setRecordingState(on) {
  ui.micButton.classList.toggle('recording', on);
  ui.micButton.setAttribute('aria-label', on ? 'Stop listening and transcribe' : 'Start listening');
  ui.micHeading.textContent = on ? 'Listening…' : 'Ready to listen';
  ui.micHelp.textContent = on ? 'Speak naturally, then click the microphone again.' : 'Press the microphone to start recording.';
}

async function startListening() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    notify('Microphone capture is not supported in this environment.', true);
    return;
  }
  try {
    stopAudio(); // Avoid transcribing our own voice.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      video: false
    });
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    recording = { stream, context, source, processor, chunks, sampleRate: context.sampleRate };
    processor.onaudioprocess = event => {
      if (!recording) return;
      const data = event.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(data));
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0); // Never play microphone input through speakers.
      let energy = 0;
      for (let i = 0; i < data.length; i += 8) energy += data[i] * data[i];
      ui.meter.style.width = Math.min(100, Math.sqrt(energy / (data.length / 8)) * 240) + '%';
      if (chunks.length * 4096 / context.sampleRate > 45) queueMicrotask(stopListening);
    };
    source.connect(processor);
    processor.connect(context.destination);
    setRecordingState(true);
    notify('Recording locally. Click the microphone again to transcribe.');
  } catch (e) {
    notify('Microphone unavailable: ' + e.message + '. Check Windows microphone permissions.', true);
  }
}

async function stopListening() {
  if (!recording) return;
  const current = recording;
  recording = null;
  setRecordingState(false);
  ui.meter.style.width = '0%';
  current.processor.disconnect();
  current.source.disconnect();
  current.processor.onaudioprocess = null;
  current.stream.getTracks().forEach(t => t.stop());
  await current.context.close();
  const samples = combineSamples(current.chunks);
  if (samples.length < current.sampleRate * 0.35) {
    notify('Recording was too short. Try again.', true);
    return;
  }
  ui.micButton.disabled = true;
  ui.micHeading.textContent = 'Transcribing…';
  notify('Recognising speech offline…');
  try {
    const wav = wavBytes(resample(samples, current.sampleRate, 16000));
    const result = await window.cody.transcribe(bytesBase64(wav));
    const transcript = (result.text || '').trim();
    ui.transcript.value = transcript;
    ui.micHeading.textContent = 'Recognised';
    if (!transcript) {
      notify('I did not recognise any words. Speak clearly and try again.');
      return;
    }
    notify('Heard: ' + transcript);
    if ($('speakBack').checked) {
      ui.text.value = transcript;
      await speak();
    }
  } catch (e) {
    ui.micHeading.textContent = 'Recognition unavailable';
    notify('Recognition failed: ' + e.message, true);
  } finally {
    ui.micButton.disabled = false;
  }
}

ui.micButton.addEventListener('click', () => recording ? stopListening() : startListening());
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

ui.engine.value = ['edge','modern','sapi'].includes(localStorage.getItem('cody-engine'))
  ? localStorage.getItem('cody-engine') : 'edge';
updateRanges();
loadVoices();
