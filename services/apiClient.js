// Every backend call goes through apiUrl(), which prefixes
// EXPO_PUBLIC_API_BASE_URL (set in the repo-root .env — see .env.example). The
// production web build leaves it empty and calls its own origin with relative
// /api/... URLs, so the browser sends the tester cookie (prod-web-android-spec.md §3).
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { getByok, reportCreditsExhausted, setCredits } from './aiAccess.js';
import { isDemoMode } from './env.js';
import { refreshSession, signIn, signOutLocal } from './googleAuth'; // no extension: Metro picks googleAuth.native.js on Android
import { getSessionToken, getUser, setSessionToken } from './storage.js';
import { reportTesterLocked } from './testerAccess.js';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || '';
const DEFAULT_TIMEOUT_MS = 60_000;

export function apiUrl(path) {
  if (!API_BASE_URL && Platform.OS === 'web') return path;
  if (!API_BASE_URL) {
    throw new Error(
      'EXPO_PUBLIC_API_BASE_URL não configurada. Defina-a no .env na raiz do repositório: EXPO_PUBLIC_API_BASE_URL=http://SEU_IP_LOCAL:8787 (ou a URL do backend publicado) — veja .env.example.'
    );
  }
  return `${API_BASE_URL}${path}`;
}

// Links the caller's AbortSignal (sheet closed, screen left) with a hard
// timeout, so a hung network never leaves a spinner up forever. A timeout
// surfaces as a named error the UI can word differently from a user cancel.
function linkedSignal(outer, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener?.('abort', onAbort);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => { clearTimeout(timer); outer?.removeEventListener?.('abort', onAbort); },
  };
}

// Routes that work without a Google account: signing in itself, and the web
// tester endpoints. Every other route is an AI call or reads the account.
const ACCOUNT_FREE_ROUTES = new Set(['/api/auth/google', '/api/tester/unlock', '/api/tester/lock']);

// Android production build: every AI call needs a Google account
// (prod-web-android-spec.md §4.1). Web testers use the cookie instead.
function needsAccount(path) {
  return Platform.OS !== 'web' && !isDemoMode() && !ACCOUNT_FREE_ROUTES.has(path);
}

function signInRequired() {
  return Object.assign(new Error('Entre com sua conta Google para usar a IA.'), { code: 'SIGN_IN_REQUIRED' });
}

// Attaches the shared x-api-key header, the account session as
// Authorization: Bearer, an Idempotency-Key on POSTs (the server requires one
// on calls that spend a credit) and the user's own AI key (BYOK) when one is
// saved, so no service file repeats the headers. On Android, a signed-out AI
// call first opens the Google account picker, and an expired session is
// renewed silently once.
export async function apiFetch(path, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, useByok = true, byok: explicitByok, recover = true, ...options } = {}) {
  if (needsAccount(path) && !getSessionToken()) {
    const user = await signIn();
    if (!user) throw signInRequired();
  }

  const headers = { ...options.headers };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  // Web is authorized by the tester cookie; the shared app key stays out of its bundle.
  if (Platform.OS !== 'web' && process.env.EXPO_PUBLIC_JOVI_API_KEY) headers['x-api-key'] = process.env.EXPO_PUBLIC_JOVI_API_KEY;
  const session = getSessionToken();
  if (session) headers['Authorization'] = `Bearer ${session}`;
  if (Platform.OS !== 'web') {
    if ((options.method || 'GET').toUpperCase() === 'POST') headers['Idempotency-Key'] = Crypto.randomUUID();
    const byok = explicitByok || (useByok && !ACCOUNT_FREE_ROUTES.has(path) ? await getByok() : null);
    if (byok) {
      headers['x-ai-provider'] = byok.provider;
      headers['x-ai-key'] = byok.apiKey;
    }
  }

  const link = linkedSignal(signal, timeoutMs);
  try {
    const response = await fetch(apiUrl(path), { credentials: 'same-origin', ...options, headers, signal: link.signal });
    // Web: an expired or revoked tester cookie sends the tester back to the access screen.
    if (Platform.OS === 'web' && response.status === 401) {
      const payload = await response.clone().json().catch(() => ({}));
      if (payload.code === 'SIGN_IN_REQUIRED' || payload.code === 'API_KEY_INVALID') reportTesterLocked();
    }
    setCredits(response.headers?.get?.('x-jovi-credits-remaining'));
    if (response.status === 402) {
      const payload = await response.clone().json().catch(() => ({}));
      if (payload.code === 'CREDITS_EXHAUSTED') reportCreditsExhausted();
    }
    // An expired/revoked session is rejected on every call until it is
    // dropped. Only the token this request carried is replaced: a slow
    // response must not wipe a session created meanwhile.
    if (response.status === 401 && session && getSessionToken() === session) {
      const payload = await response.clone().json().catch(() => ({}));
      if (payload.code === 'SESSION_INVALID') {
        if (recover && getUser() && await refreshSession()) {
          return apiFetch(path, { timeoutMs, signal, useByok, byok: explicitByok, recover: false, ...options });
        }
        signOutLocal();
      }
    }
    return response;
  } catch (error) {
    if (link.timedOut()) throw Object.assign(new Error('A resposta demorou demais. Confira a conexão e tente novamente.'), { name: 'TimeoutError' });
    throw error;
  } finally {
    link.dispose();
  }
}

export { getSessionToken, setSessionToken };
