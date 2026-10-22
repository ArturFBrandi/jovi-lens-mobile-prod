// Android AI access state (prod-web-android-spec.md §4.2, §4.5): free credits
// left on the signed-in Google account and the user's own AI key (BYOK). The
// key itself only lives in secure storage under the account; React state only
// sees the provider and a masked preview.
import { useSyncExternalStore } from 'react';
import { apiFetch } from './apiClient.js';
import { deleteSecret, readSecret, writeSecret } from './byokStore'; // no extension: Metro picks byokStore.native.js on Android
import { getSessionToken, getUser } from './storage.js';

export const FREE_CREDITS = 3;

export const BYOK_PROVIDERS = [
  { value: 'gemini', label: 'Gemini', hint: 'Crie uma chave gratuita em aistudio.google.com (sem cartão). No plano gratuito o Google pode usar o conteúdo para melhorar seus produtos.' },
  { value: 'openai', label: 'OpenAI', hint: 'Crie uma chave de projeto em platform.openai.com e defina um limite de gastos mensal para o projeto.' },
  { value: 'minimax', label: 'MiniMax', hint: 'Use uma chave dedicada e mantenha um saldo baixo. Transcrição por voz usa o reconhecimento do aparelho.' },
];

let state = { creditsRemaining: null, byok: null, creditsExhausted: false };
const listeners = new Set();

function update(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// { creditsRemaining: number|null, byok: { provider, masked } | null, creditsExhausted: boolean }
export function useAiAccess() {
  return useSyncExternalStore(subscribe, () => state);
}

export function setCredits(n) {
  const value = Number(n);
  if (n !== null && n !== undefined && n !== '' && Number.isFinite(value)) update({ creditsRemaining: value });
}

export function resetAiAccess() {
  update({ creditsRemaining: null, byok: null, creditsExhausted: false });
}

// Raised by apiClient when the server answers CREDITS_EXHAUSTED; the root
// layout shows one notice with the way out (bring your own key) for every screen.
export function reportCreditsExhausted() {
  update({ creditsRemaining: 0, creditsExhausted: true });
}

export function dismissCreditsExhausted() {
  update({ creditsExhausted: false });
}

// Never prompts: without a session there is nothing to read yet.
export async function refreshCredits() {
  if (!getUser() || !getSessionToken()) return;
  try {
    const response = await apiFetch('/api/me', { method: 'GET', useByok: false });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) setCredits(payload.creditsRemaining);
  } catch {
    // Keep the last known value; the next AI call refreshes it via its header.
  }
}

function storageKey() {
  const sub = getUser()?.id;
  return sub ? `byok.${sub}` : null;
}

function mask(apiKey) {
  return `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`;
}

export function providerLabel(provider) {
  return BYOK_PROVIDERS.find((item) => item.value === provider)?.label || provider;
}

export async function getByok() {
  const key = storageKey();
  if (!key) return null;
  try {
    const parsed = JSON.parse((await readSecret(key)) || 'null');
    return parsed?.provider && parsed?.apiKey ? { provider: parsed.provider, apiKey: parsed.apiKey } : null;
  } catch {
    return null;
  }
}

export async function loadByok() {
  const saved = await getByok();
  update({ byok: saved ? { provider: saved.provider, masked: mask(saved.apiKey) } : null });
}

// Validates the key with the provider (through the server) before saving it.
// Throws with the server's pt-BR message when the key is refused.
export async function saveByok(provider, apiKey) {
  const trimmed = String(apiKey || '').trim();
  const key = storageKey();
  if (!key) throw new Error('Entre com sua conta Google para salvar uma chave.');
  const response = await apiFetch('/api/byok/validate', { method: 'POST', body: '{}', byok: { provider, apiKey: trimmed } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || 'Não foi possível validar a chave.'), { code: payload.code });
  await writeSecret(key, JSON.stringify({ provider, apiKey: trimmed }));
  update({ byok: { provider, masked: mask(trimmed) }, creditsExhausted: false });
}

export async function removeByok() {
  const key = storageKey();
  if (key) await deleteSecret(key);
  update({ byok: null });
}
