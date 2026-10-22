// Every backend call goes through apiUrl(), which prefixes
// EXPO_PUBLIC_API_BASE_URL (set in the repo-root .env — see .env.example). The
// production web build leaves it empty and calls its own origin with relative
// /api/... URLs, so the browser sends the tester cookie (prod-web-android-spec.md §3).
import { Platform } from 'react-native';
import { getSessionToken, setSessionToken } from './storage.js';
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

// Attaches the shared x-api-key header (see auth-plan.md Phase 1) and, when
// signed in, the account session (Phase 2 — see services/googleAuth.js) as
// Authorization: Bearer, so every backend call gets both without each service
// file repeating the headers.
export async function apiFetch(path, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...options } = {}) {
  const headers = { ...options.headers };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  // Web is authorized by the tester cookie; the shared app key stays out of its bundle.
  if (Platform.OS !== 'web' && process.env.EXPO_PUBLIC_JOVI_API_KEY) headers['x-api-key'] = process.env.EXPO_PUBLIC_JOVI_API_KEY;
  const session = getSessionToken();
  if (session) headers['Authorization'] = `Bearer ${session}`;

  const link = linkedSignal(signal, timeoutMs);
  try {
    const response = await fetch(apiUrl(path), { credentials: 'same-origin', ...options, headers, signal: link.signal });
    // Web: an expired or revoked tester cookie sends the tester back to the access screen.
    if (Platform.OS === 'web' && response.status === 401) {
      const payload = await response.clone().json().catch(() => ({}));
      if (payload.code === 'SIGN_IN_REQUIRED' || payload.code === 'API_KEY_INVALID') reportTesterLocked();
    }
    // An expired/revoked session is rejected on every call until it is
    // dropped; without this the user stays stuck on 401 until they find
    // "Sair" in Perfil. The next call falls back to anonymous limits.
    if (response.status === 401 && session) {
      const payload = await response.clone().json().catch(() => ({}));
      // Only drop the token this request carried: a slow response must not
      // wipe a session the user created by signing in again meanwhile.
      if (payload.code === 'SESSION_INVALID' && getSessionToken() === session) setSessionToken(null);
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
