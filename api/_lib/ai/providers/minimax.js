import { abortableTimeout, emptyResponseError, httpError, notConfigured, timeoutError } from './shared.js';

// Verified against https://platform.minimax.io/docs (Sept 2026) — MiniMax's
// chat endpoint is OpenAI-compatible (Bearer auth, choices[0].message.content,
// and the same { type:'image_url', image_url:{url} } content-part shape this
// app already produces), but TTS/video are MiniMax's own REST shape with a
// { base_resp: { status_code, status_msg } } envelope instead of plain HTTP
// error codes, and TTS lives on a separate subdomain from chat/video.
const DEFAULT_BASE_URL = 'https://api.minimax.io';
const DEFAULT_TTS_BASE_URL = 'https://api-uw.minimax.io';

// speech-2.8-hd is MiniMax's current flagship TTS model as of this writing.
// MiniMax's catalog moves fast, so override via env if this ages out.
// Text-only calls (follow-up questions, subject content) use MiniMax-Text-01:
// measured 2026-10-22, M3 and M2.x broke about half of their pt-BR replies
// with mixed-in English/Chinese tokens ("realizationava", "fábrica de九江"),
// while Text-01 gave 0/9 slips. Calls carrying an image keep M3, whose photo
// analysis is far more detailed (Text-01 accepts images but is shallow).
const DEFAULT_CHAT_MODEL = 'MiniMax-Text-01';
const DEFAULT_VISION_MODEL = 'MiniMax-M3';
const DEFAULT_TTS_MODEL = 'speech-2.8-hd';

// Confirmed live via /v1/get_voice against the account's own key — MiniMax's
// "Portuguese" voice pool has no separate Brazilian/European variant (same
// for language_boost below), so this is the closest the API can target, not
// a guaranteed BR accent.
const ROLE_VOICE = {
  A: process.env.MINIMAX_VOICE_A || 'Portuguese_ChattyGirl',
  B: process.env.MINIMAX_VOICE_B || 'Portuguese_WiseScholar',
  narrator: process.env.MINIMAX_VOICE_NARRATOR || 'Portuguese_Narrator',
  coach: process.env.MINIMAX_VOICE_COACH || process.env.MINIMAX_VOICE_A || 'Portuguese_ChattyGirl',
  feedback: process.env.MINIMAX_VOICE_FEEDBACK || process.env.MINIMAX_VOICE_B || 'Portuguese_WiseScholar',
};

// T2A allows up to 10,000 chars/request (vs. Azure's 4096) — larger chunks,
// fewer round-trips.
export const ttsChunkLimit = 9500;

export const capabilities = { chat: true, vision: true, tts: true, stt: false };

function getConfig(credentials) {
  return {
    apiKey: credentials?.apiKey || process.env.MINIMAX_API_KEY,
    baseUrl: (process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    ttsBaseUrl: (process.env.MINIMAX_TTS_BASE_URL || DEFAULT_TTS_BASE_URL).replace(/\/$/, ''),
    chatModel: process.env.MINIMAX_CHAT_MODEL || DEFAULT_CHAT_MODEL,
    visionModel: process.env.MINIMAX_VISION_MODEL || DEFAULT_VISION_MODEL,
    ttsModel: process.env.MINIMAX_TTS_MODEL || DEFAULT_TTS_MODEL,
  };
}

export function isConfigured(capability, credentials) {
  const config = getConfig(credentials);
  if (capability === 'chat') return Boolean(config.apiKey && config.chatModel);
  if (capability === 'vision') return Boolean(config.apiKey && config.visionModel);
  if (capability === 'tts') return Boolean(config.apiKey && config.ttsModel);
  return false;
}

// MiniMax's own (non-OpenAI-compatible) endpoints return HTTP 200 even on
// logical failure — the real result is base_resp.status_code (0 = success).
function checkBaseResp(payload, message) {
  const statusCode = payload?.base_resp?.status_code;
  if (statusCode === undefined || statusCode === 0) return;
  const error = new Error(payload?.base_resp?.status_msg || message);
  error.code = statusCode === 1002 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR';
  error.status = statusCode;
  throw error;
}

async function chatCompletion(config, { model, messages, maxTokens, timeoutMs }) {
  const { controller, clear } = abortableTimeout(timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      // "adaptive" thinking (M3's default) adds ~30s of reasoning-token latency
      // for this kind of vision+structured-JSON task — measured 35.7s with it
      // on vs. 7.8s disabled, for the exact same prompt. Disabling it keeps
      // responses well under the abort timeout without hurting output quality.
      body: JSON.stringify({ model, messages, temperature: 0.2, max_completion_tokens: maxTokens, thinking: { type: 'disabled' } }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw httpError('Falha no serviço de IA.', response.status);
    checkBaseResp(payload, 'Falha no serviço de IA.');

    const text = payload?.choices?.[0]?.message?.content;
    if (!text || typeof text !== 'string') throw emptyResponseError('A IA não retornou conteúdo.');
    return text;
  } catch (error) {
    if (error?.name === 'AbortError') throw timeoutError('Tempo limite da análise excedido.');
    throw error;
  } finally {
    clear();
  }
}

// Han, kana and Hangul. MiniMax models (M3 for images, measured 2026-10-22)
// sometimes drop a Chinese word into a pt-BR answer ("fábrica de九江").
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/;

function messagesText(messages) {
  return messages.map((message) => (Array.isArray(message.content)
    ? message.content.map((part) => part?.text || '').join(' ')
    : String(message.content || ''))).join(' ');
}

// Asks the text model (Text-01, clean pt-BR) to replace the slipped words,
// keeping the JSON intact. Only used when a slip is detected, so clean
// answers pay nothing. Returns null when the repair is unusable.
async function repairForeignScript(config, text) {
  const instruction = 'O texto a seguir deveria estar todo em português do Brasil, mas contém algumas palavras em chinês, japonês ou coreano por erro. '
    + 'Substitua só essas palavras pelo equivalente correto em português, de acordo com o contexto. Não mude nada além disso: mantenha a mesma estrutura, as mesmas chaves e o restante do texto. '
    + 'Responda somente com o texto corrigido, sem comentários e sem markdown.\n\n';
  const repaired = await chatCompletion(config, { model: config.chatModel, messages: [{ role: 'user', content: instruction + text }], maxTokens: 3200, timeoutMs: 20000 });
  if (CJK.test(repaired)) return null;
  const wasJson = (() => { try { JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); return true; } catch { return false; } })();
  if (wasJson) {
    try { JSON.parse(repaired.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
  }
  return repaired;
}

export async function complete({ messages, maxTokens = 1400, timeoutMs = 22000, credentials }) {
  const config = getConfig(credentials);
  const hasImage = messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part?.type === 'image_url'));
  const model = hasImage ? config.visionModel : config.chatModel;
  if (!isConfigured(hasImage ? 'vision' : 'chat', credentials)) throw notConfigured('MiniMax não está configurado.');

  const text = await chatCompletion(config, { model, messages, maxTokens, timeoutMs });
  // A CJK word the request did not contain is a slip, not content to keep.
  if (CJK.test(text) && !CJK.test(messagesText(messages))) {
    const repaired = await repairForeignScript(config, text).catch(() => null);
    if (repaired) return { text: repaired, model, provider: 'minimax' };
  }
  return { text, model, provider: 'minimax' };
}

// --- Text-to-speech (T2A v2) --------------------------------------------
export async function speak({ text, voice = 'narrator', format = 'mp3', timeoutMs = 30000, credentials }) {
  const config = getConfig(credentials);
  if (!isConfigured('tts', credentials)) throw notConfigured('TTS da MiniMax não está configurado.');
  const voiceId = ROLE_VOICE[voice] || ROLE_VOICE.narrator;

  const { controller, clear } = abortableTimeout(timeoutMs);
  try {
    const response = await fetch(`${config.ttsBaseUrl}/v1/t2a_v2`, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ttsModel,
        text,
        voice_setting: { voice_id: voiceId, speed: 1, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, format, channel: 1 },
        // No Brazilian-specific enum value exists — 'Portuguese' is the
        // closest hint T2A's language_boost accepts.
        language_boost: 'Portuguese',
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw httpError('Falha ao gerar áudio.', response.status);
    checkBaseResp(payload, 'Falha ao gerar áudio.');

    const hex = payload?.data?.audio;
    if (!hex) throw emptyResponseError('A IA não retornou áudio.');
    return { buffer: Buffer.from(hex, 'hex'), mimeType: format === 'mp3' ? 'audio/mpeg' : `audio/${format}`, model: config.ttsModel, provider: 'minimax' };
  } catch (error) {
    if (error?.name === 'AbortError') throw timeoutError('Tempo limite do áudio excedido.');
    throw error;
  } finally {
    clear();
  }
}

// MiniMax has no speech-to-text; the capability flag keeps callers away, and
// this only exists so every adapter exposes the same interface.
export async function transcribe() {
  throw Object.assign(new Error('MiniMax não oferece transcrição.'), { code: 'BYOK_CAPABILITY_UNSUPPORTED' });
}

// MiniMax has no cheap key-check endpoint: a tiny completion proves the key.
export async function validateKey(credentials) {
  await complete({ messages: [{ role: 'user', content: 'Responda apenas {"ok":true}' }], maxTokens: 20, timeoutMs: 15000, credentials });
  return { ok: true };
}
