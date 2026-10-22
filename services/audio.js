import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';
import { isDemoMode } from './env.js';
import { apiFetch } from './apiClient.js';

// "Browser" pitch differentiates speakers when only one pt-BR voice exists for
// the on-device fallback (expo-speech, RN's equivalent of speechSynthesis).
// The live path sends the role itself ('A'/'B'/'narrator'/'coach'/'feedback') to /api/tts — the
// active provider maps it to a real voice ID server-side.
const BROWSER_PITCH = { A: 1.08, B: 0.94, narrator: 1, coach: 1.04, feedback: 0.96 };
const BROWSER_RATE = { A: 0.92, B: 0.88, narrator: 0.9, coach: 0.91, feedback: 0.88 };

let liveTtsAvailable = null; // null unknown | true | false (not configured / repeatedly unreachable)
let consecutiveFailures = 0;
// The server synthesizes a segment in <=4000-character chunks, one after the
// other, allowing 30 s each; the client waits at least that long per chunk so it
// never abandons audio the provider was already paid to generate.
function ttsTimeoutFor(text) {
  return 35_000 * Math.max(1, Math.ceil(String(text).length / 4000));
}

export function ttsMode() {
  if (isDemoMode()) return 'browser';
  return liveTtsAvailable === false ? 'browser' : 'live';
}

export function noteToSpeech(note) {
  const parts = [note?.title, note?.summary, ...(Array.isArray(note?.keyPoints) ? note.keyPoints : [])].filter(Boolean);
  return parts.join('. ').slice(0, 3000);
}

let cachedVoiceId; // undefined = not looked up yet, null = none found
function ensureVoiceLookup() {
  if (cachedVoiceId !== undefined) return;
  cachedVoiceId = null;
  Speech.getAvailableVoicesAsync()
    .then((voices) => {
      const voice = voices.find((v) => /pt.BR/i.test(v.language)) || voices.find((v) => /^pt/i.test(v.language));
      cachedVoiceId = voice?.identifier || null;
    })
    .catch(() => { cachedVoiceId = null; });
}

// --- On-disk TTS cache -------------------------------------------------------
// Every live segment is a paid provider call. Replaying a podcast, reopening
// a lesson or hitting "Ouvir" twice used to regenerate identical audio each
// time; now each (voice, text) pair is synthesized once and replayed from the
// cache directory (which the OS may purge — a miss just refetches).
const CACHE_VERSION = 'v1';
const TTS_DIR = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}jovi-tts/` : null;
const inflight = new Map();

// cyrb53 — a fast 53-bit string hash; collisions are irrelevant at this scale.
function hashText(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function cacheKey(text, voice) {
  return `${CACHE_VERSION}-${voice}-${hashText(`${voice}|${text}`)}`;
}

async function readCache(key) {
  if (!TTS_DIR) return null;
  try {
    const manifest = JSON.parse(await FileSystem.readAsStringAsync(`${TTS_DIR}${key}.json`));
    const uris = Array.from({ length: manifest.parts }, (_, index) => `${TTS_DIR}${key}-${index}.${manifest.ext}`);
    const checks = await Promise.all(uris.map((uri) => FileSystem.getInfoAsync(uri)));
    return checks.every((info) => info.exists) ? uris : null;
  } catch {
    return null;
  }
}

async function writeCache(key, parts, mimeType) {
  if (!TTS_DIR || !parts.length) return null;
  try {
    const info = await FileSystem.getInfoAsync(TTS_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(TTS_DIR, { intermediates: true });
    const ext = mimeType === 'audio/mpeg' ? 'mp3' : mimeType.split('/')[1] || 'mp3';
    const uris = parts.map((_, index) => `${TTS_DIR}${key}-${index}.${ext}`);
    await Promise.all(parts.map((b64, index) => FileSystem.writeAsStringAsync(uris[index], b64, { encoding: FileSystem.EncodingType.Base64 })));
    // Manifest last: a crash mid-write leaves no manifest, so no half entry is served.
    await FileSystem.writeAsStringAsync(`${TTS_DIR}${key}.json`, JSON.stringify({ parts: parts.length, ext }));
    return uris;
  } catch {
    return null;
  }
}

// Returns playable URIs for one segment, or null when live TTS is not usable
// right now (caller falls back to on-device speech for this narration).
async function requestLiveTts(text, voice) {
  const key = cacheKey(text, voice);
  const cached = await readCache(key);
  if (cached) return cached;

  let response;
  try {
    response = await apiFetch('/api/tts', { method: 'POST', body: JSON.stringify({ text, voice }), timeoutMs: ttsTimeoutFor(text) });
  } catch (error) {
    // One flaky request used to disable live voice for the whole session.
    // Only give up session-wide after repeated network failures; a slow
    // (timed-out) segment says nothing about the next one.
    if (error?.name !== 'TimeoutError') {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 2) liveTtsAvailable = false;
    }
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 503 || data.code === 'AI_NOT_CONFIGURED') { liveTtsAvailable = false; return null; }
  // Rate limit or provider error: this narration continues with the device
  // voice instead of stopping mid-podcast on an error banner.
  if (!response.ok) return null;
  consecutiveFailures = 0;
  liveTtsAvailable = true;
  const mime = data.mimeType || 'audio/mpeg';
  const parts = Array.isArray(data.parts) ? data.parts : [];
  return (await writeCache(key, parts, mime)) || parts.map((b64) => `data:${mime};base64,${b64}`);
}

// De-duplicates concurrent requests for the same segment, so the prefetch of
// segment N+1 and the playback that reaches it share one provider call.
function fetchLiveTts(text, voice) {
  const key = cacheKey(text, voice);
  if (!inflight.has(key)) {
    inflight.set(key, requestLiveTts(text, voice).finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

// Narration is meant to keep going with the screen off (the car format is
// listened to hands-free) and through the iOS silent switch; the plugin
// declares the background capability, but the session has to ask for it.
// allowsRecording:false also moves iOS output back to the speaker after a
// voice question left it on the earpiece.
function ensurePlaybackMode() {
  setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, allowsRecording: false, interruptionMode: 'duckOthers' }).catch(() => {});
}

// After a "coach" question in the car format the student answers out loud;
// playing the feedback immediately left no time to answer at all. With live
// audio the pause is a 7 s silent clip played through the same player, so iOS
// keeps the app running with the screen off (a bare timer would be suspended
// between clips); the device voice falls back to a timer.
export const ANSWER_PAUSE_MS = 7000;
const ANSWER_PAUSE_SOUND = require('../assets/audio/answer-pause.wav');

// Single shared narrator: only one narration plays at a time across the app.
class Narration {
  constructor() {
    this.player = createAudioPlayer(null);
    // A single persistent listener, guarded by activeToken (set right before
    // each play()) rather than reassigned per segment like the web version's
    // audio.onended — expo-audio's AudioPlayer has no per-call onended hook.
    this.player.addListener('playbackStatusUpdate', (status) => {
      if (!status.didJustFinish || this.stale(this.activeToken)) return;
      if (this.gapPending) { this.gapPending = false; this.playSegment(this.activeToken); return; }
      this.playParts(this.activeToken);
    });
    this.segments = [];
    this.index = 0;
    this.partQueue = [];
    this.state = 'idle'; // idle | playing | paused | done
    this.handlers = {};
    this.usingBrowser = false; // true = on-device (expo-speech) fallback, matching ttsMode()'s 'browser' value
    this.cancelled = false;
    this.token = 0; // bumped on every start(); stale async continuations bail out.
    this.activeToken = null; // token the player is currently playing audio for
    this.pendingResume = null; // set when paused while a segment's audio was still fetching.
    this.gapTimer = null; // answer pause as a timer (only if the silent clip failed)
    this.gapPending = false; // answer pause playing as a silent clip
    this.waiting = false; // inside the answer pause ("Sua vez") — part of every update
  }

  emit(extra = {}) {
    this.handlers.onUpdate?.({ index: this.index, state: this.state, total: this.segments.length, mode: this.usingBrowser ? 'browser' : 'live', waiting: this.waiting, ...extra });
  }

  start(segments, handlers = {}, startIndex = 0) {
    // Supersede any previous owner.
    if (this.handlers.onUpdate && this.handlers !== handlers) this.handlers.onUpdate({ index: this.index, state: 'idle', total: 0, superseded: true });
    this.stopMedia();
    this.cancelled = false;
    this.token += 1;
    this.segments = segments || [];
    this.index = Math.min(Math.max(0, startIndex), Math.max(0, this.segments.length - 1));
    this.partQueue = [];
    this.handlers = handlers;
    this.state = 'playing';
    this.usingBrowser = ttsMode() === 'browser';
    ensurePlaybackMode();
    this.playSegment(this.token);
  }

  stale(token) {
    return this.cancelled || token !== this.token;
  }

  async playSegment(token) {
    if (this.stale(token)) return;
    this.waiting = false;
    if (this.index >= this.segments.length) { this.state = 'done'; this.emit(); this.handlers.onEnd?.(); return; }
    this.emit();
    const segment = this.segments[this.index];
    if (!this.usingBrowser) {
      let urls;
      try {
        urls = await fetchLiveTts(segment.text, segment.speaker || 'narrator');
      } catch (error) {
        if (this.stale(token)) return;
        this.state = 'idle';
        this.emit({ error: error.message });
        return;
      }
      if (this.stale(token)) return;
      if (urls === null) {
        this.usingBrowser = true;
        // Paused while this segment was fetching: the device voice waits for
        // "Retomar" like the live path does, instead of talking over the pause.
        if (this.state === 'paused') { this.pendingResume = () => this.playSegment(token); return; }
        return this.playSegment(token);
      }
      this.partQueue = urls;
      this.prefetchNext(token);
      // If the user paused while this segment was still fetching, wait for resume.
      if (this.state === 'paused') { this.pendingResume = () => this.playParts(token); return; }
      return this.playParts(token);
    }
    return this.speakDevice(segment, token);
  }

  // Warms the cache for the following segment while this one plays, so the
  // gap between speakers is a cache read instead of a network round trip.
  prefetchNext(token) {
    const next = this.segments[this.index + 1];
    if (!next || this.usingBrowser || this.stale(token)) return;
    fetchLiveTts(next.text, next.speaker || 'narrator').catch(() => {});
  }

  // Moves to the next segment, holding a silent answer window after a coach
  // question (the UI shows "Sua vez" while `waiting` is true).
  advance(token) {
    if (this.stale(token)) return;
    const finished = this.segments[this.index];
    this.index += 1;
    if (finished?.speaker === 'coach' && this.index < this.segments.length) {
      this.waiting = true;
      this.emit();
      // The silent clip plays through the player for BOTH voices: the player is
      // idle while the device voice speaks, and something must be playing for
      // iOS to keep the app running with the screen off.
      try {
        this.gapPending = true;
        this.activeToken = token;
        this.player.replace(ANSWER_PAUSE_SOUND);
        this.player.play();
        return;
      } catch {
        this.gapPending = false; // fall through to the timer
      }
      this.gapTimer = setTimeout(() => {
        this.gapTimer = null;
        if (this.stale(token)) return;
        if (this.state === 'paused') { this.pendingResume = () => this.playSegment(token); return; }
        this.playSegment(token);
      }, ANSWER_PAUSE_MS);
      return;
    }
    this.playSegment(token);
  }

  playParts(token) {
    if (this.stale(token)) return;
    if (!this.partQueue.length) return this.advance(token);
    const url = this.partQueue.shift();
    try {
      this.activeToken = token;
      this.player.replace(url);
      this.player.play();
    } catch {
      if (this.stale(token)) return;
      this.state = 'paused';
      this.emit();
    }
  }

  speakDevice(segment, token) {
    ensureVoiceLookup();
    Speech.speak(segment.text, {
      language: 'pt-BR',
      voice: cachedVoiceId || undefined,
      pitch: BROWSER_PITCH[segment.speaker] ?? 1,
      rate: BROWSER_RATE[segment.speaker] ?? 0.9,
      onDone: () => this.advance(token),
      onError: () => this.advance(token),
    });
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    if (this.gapTimer) {
      // Paused inside an answer window: resume continues with the next segment.
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
      const token = this.token;
      this.pendingResume = () => this.playSegment(token);
      this.emit();
      return;
    }
    if (this.gapPending || !this.usingBrowser) {
      try { this.player.pause(); } catch { /* no-op */ }
    } else if (Platform.OS === 'android') {
      // expo-speech cannot pause on Android (pause/resume reject there), so a
      // pause stops the sentence and "Retomar" says the same segment again.
      const token = this.token;
      Speech.stop();
      this.pendingResume = () => this.playSegment(token);
    } else {
      Speech.pause();
    }
    this.emit();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    // Pending work first (a segment that finished fetching, or an answer window
    // that was paused) — for both the live and the device voice.
    if (this.pendingResume) { const run = this.pendingResume; this.pendingResume = null; this.emit(); run(); return; }
    if (this.usingBrowser && !this.gapPending) { Speech.resume(); this.emit(); return; }
    try { this.player.play(); } catch { this.state = 'paused'; }
    this.emit();
  }

  stopMedia() {
    this.pendingResume = null;
    this.gapPending = false;
    this.waiting = false;
    if (this.gapTimer) { clearTimeout(this.gapTimer); this.gapTimer = null; }
    Speech.stop();
    try { this.player.pause(); } catch { /* no-op */ }
  }

  stop() {
    this.cancelled = true;
    this.state = 'idle';
    this.stopMedia();
    this.emit();
    this.handlers = {};
  }
}

export const narration = new Narration();
