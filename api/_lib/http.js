// Shared HTTP helpers for the JOVI Lens API handlers: API-key and session
// checks, payload signature validation and the public error-code table.
// Rate limiting lives in api/_lib/guard.js on top of api/_lib/store.js.

import { timingSafeEqual } from 'node:crypto';
import { isIPv6 } from 'node:net';
import { verifySession } from './session.js';

// Static shared-secret gate. A speed bump, not real authentication: the key
// ships inside the app bundle, so anyone who extracts it can still call the
// API directly. Google sign-in and per-account credits are the real controls
// (see prod-web-android-spec.md §4.3).
export function hasValidApiKey(req) {
  const expected = process.env.JOVI_API_KEY;
  if (!expected) return true; // unset = feature opt-in, same pattern as GOOGLE_CLIENT_ID
  const provided = String(req.headers['x-api-key'] || '');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Reads the app-issued session from `Authorization: Bearer <token>` (see
// api/_lib/session.js). `provided` distinguishes "no header" (401
// SIGN_IN_REQUIRED) from "header present but invalid/expired" (401
// SESSION_INVALID), which the client handles differently.
export function sessionUser(req) {
  const header = String(req.headers['authorization'] || '');
  if (!header.startsWith('Bearer ')) return { provided: false, user: null };
  return { provided: true, user: verifySession(header.slice(7)) };
}

// Exact MIME essence: "text/plain;application/json" contains the substring but
// is a CORS-safelisted type a browser sends cross-site without a preflight.
export function isJsonContentType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase() === 'application/json';
}

// IPv6 clients control a whole /64; keying on the full /128 let one client
// rotate addresses to get fresh buckets. The address is expanded to its 8
// groups first — the compressed text form places "::" differently for
// addresses of the same /64. IPv4 (and IPv4-mapped) stay exact.
export function ipKey(ip) {
  const value = String(ip).slice(0, 80).split('%')[0];
  if (!isIPv6(value) || value.toLowerCase().startsWith('::ffff:')) return value;
  const [head, tail = ''] = value.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = value.includes('::') && tail ? tail.split(':') : [];
  const groups = value.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export function hasKnownImageSignature(base64, mimeType) {
  try {
    // Only the header is needed for magic-byte detection — avoid decoding megabytes.
    const bytes = Buffer.from(base64.slice(0, 32), 'base64');
    if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
    if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mimeType === 'image/webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  } catch {
    return false;
  }
  return false;
}

// Lightweight magic-byte check for the audio formats a browser MediaRecorder /
// getUserMedia flow produces, used by the transcription endpoint.
export function hasKnownAudioSignature(base64, mimeType) {
  try {
    // Header-only decode; the full audio is decoded once later for the upload.
    const bytes = Buffer.from(base64.slice(0, 32), 'base64');
    if (mimeType.includes('webm') || mimeType.includes('ogg')) return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 ? true : bytes.subarray(0, 4).toString() === 'OggS';
    if (mimeType.includes('wav')) return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE';
    if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) || bytes.subarray(0, 3).toString() === 'ID3';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) return bytes.subarray(4, 8).toString() === 'ftyp';
  } catch {
    return false;
  }
  return false;
}

const SERVICE_UNAVAILABLE = 'Serviço indisponível no momento. Tente novamente em instantes.';
const DEFAULT_MESSAGE = 'Não foi possível concluir agora. Tente novamente.';

// Server → client error contract (prod-implementation-spec.md §5.4). Every
// error body is { code, message } with a pt-BR message.
export const ERRORS = {
  INVALID_JSON: { status: 400, message: 'Requisição inválida.' },
  INVALID_INPUT: { status: 400, message: 'Requisição inválida.' },
  TEXT_TOO_LONG: { status: 400, message: 'Texto longo demais para gerar áudio.' },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'Requisição sem identificador. Atualize o app.' },
  BYOK_INVALID_FORMAT: { status: 400, message: 'Formato de chave de IA inválido.' },
  BYOK_CAPABILITY_UNSUPPORTED: { status: 400, message: 'Seu provedor de IA não oferece este recurso.' },
  API_KEY_INVALID: { status: 401, message: 'Acesso não autorizado.' },
  SIGN_IN_REQUIRED: { status: 401, message: 'Entre com sua conta Google para usar a IA.' },
  SESSION_INVALID: { status: 401, message: 'Sua sessão expirou. Entre novamente.' },
  GOOGLE_TOKEN_INVALID: { status: 401, message: 'Token Google inválido para este aplicativo.' },
  GOOGLE_TOKEN_REUSED: { status: 401, message: 'Esta credencial Google já foi usada. Entre novamente.' },
  TESTER_CODE_INVALID: { status: 401, message: 'Código de acesso inválido.' },
  CREDITS_EXHAUSTED: { status: 402, message: 'Você usou suas 3 interações gratuitas. Adicione sua própria chave de IA para continuar.' },
  INTEGRITY_FAILED: { status: 403, message: 'Não foi possível verificar este aparelho. Use o app oficial em um aparelho sem modificações.' },
  BYOK_REQUIRED: { status: 403, message: 'Vozes e transcrição da IA exigem sua própria chave. Usando a voz do aparelho.' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'Método não permitido.' },
  REQUEST_IN_PROGRESS: { status: 409, message: 'Este pedido ainda está sendo processado.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'Arquivo grande demais para enviar.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'Tipo de conteúdo não suportado.' },
  BYOK_REJECTED: { status: 422, message: 'Sua chave de IA foi recusada pelo provedor. Confira ou troque a chave.' },
  RATE_LIMITED: { status: 429, message: 'Muitos pedidos em sequência. Tente novamente em instantes.' },
  SIGNUP_LIMITED: { status: 429, message: 'Muitas contas novas nesta rede hoje. Tente novamente amanhã.' },
  TESTER_CAP_REACHED: { status: 429, message: 'Limite diário de testes atingido. Tente amanhã.' },
  AI_RATE_LIMITED: { status: 429, message: 'O serviço de IA está temporariamente ocupado. Tente novamente em instantes.' },
  AI_UNAVAILABLE: { status: 502, message: DEFAULT_MESSAGE },
  AI_PROVIDER_ERROR: { status: 502, message: DEFAULT_MESSAGE },
  AI_INVALID_RESPONSE: { status: 502, message: 'Recebemos uma resposta que não pôde ser organizada. Tente novamente.' },
  AI_EMPTY_RESPONSE: { status: 502, message: 'A IA não retornou um resultado utilizável. Tente novamente.' },
  AI_RESPONSE_TOO_LARGE: { status: 502, message: 'A resposta da IA ficou grande demais. Tente um conteúdo menor.' },
  GOOGLE_UNAVAILABLE: { status: 502, message: 'Não foi possível validar com o Google agora. Tente novamente.' },
  AI_NOT_CONFIGURED: { status: 503, message: 'Este recurso ao vivo ainda não está configurado. Ative o modo demonstração ou configure o serviço de IA.' },
  STORE_UNAVAILABLE: { status: 503, message: SERVICE_UNAVAILABLE },
  SERVER_MISCONFIGURED: { status: 503, message: SERVICE_UNAVAILABLE },
  INTEGRITY_UNAVAILABLE: { status: 503, message: SERVICE_UNAVAILABLE },
  AI_TIMEOUT: { status: 504, message: 'A geração demorou mais que o esperado. Tente novamente.' },
};

// { status, code, message } for a known code; anything unknown becomes a
// generic 502 AI_UNAVAILABLE so internal details never reach the client.
export function errorBody(code) {
  const known = ERRORS[code];
  if (!known) return { status: 502, code: 'AI_UNAVAILABLE', message: DEFAULT_MESSAGE };
  return { status: known.status, code, message: known.message };
}

// Maps a thrown provider/service error to the public status + message.
// AI_PROVIDER_AUTH is converted by the guard first (it depends on BYOK).
export function errorResponse(error) {
  return errorBody(error?.code || 'AI_UNAVAILABLE');
}
