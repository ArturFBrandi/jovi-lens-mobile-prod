// Web tester access (prod-web-android-spec.md §3.2). The tester key never
// reaches the browser: the access code is exchanged at /api/tester/unlock for
// an HttpOnly cookie the browser then sends with every same-origin API call.
// This module only tracks whether that cookie is currently accepted.
import { Platform } from 'react-native';
import { isDemoMode } from './env.js';

const listeners = new Set();
let state = 'unknown'; // unknown | unlocked | locked

function setState(next) {
  if (state === next) return;
  state = next;
  listeners.forEach((listener) => listener(state));
}

// The production web build is the only one gated by tester access.
export function testerGateActive() {
  return Platform.OS === 'web' && !isDemoMode();
}

export function getTesterState() {
  return state;
}

export function subscribeTesterState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportTesterLocked() {
  if (testerGateActive()) setState('locked');
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload };
}

// Exchanges the access code for the tester cookie. Throws with the server's
// pt-BR message on a wrong code or rate limit.
export async function unlock(code) {
  const { ok, payload } = await postJson('/api/tester/unlock', { code });
  if (!ok) throw Object.assign(new Error(payload.message || 'Não foi possível validar o código.'), { code: payload.code });
  setState('unlocked');
}

export async function checkAccess() {
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    setState(response.ok && payload.tester ? 'unlocked' : 'locked');
  } catch {
    setState('locked');
  }
  return state;
}

// On first load: a distributed link (?acesso=<code>) unlocks directly, and the
// code is removed from the address bar so it is not left in history or shared
// by copying the URL.
export async function initTesterAccess() {
  const url = new globalThis.URL(globalThis.location.href);
  const code = url.searchParams.get('acesso');
  if (code) {
    url.searchParams.delete('acesso');
    globalThis.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    try {
      await unlock(code);
      return state;
    } catch {
      // Fall through: the access screen explains what to do.
    }
  }
  return checkAccess();
}
