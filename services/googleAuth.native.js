// Native Google sign-in for the Android app (prod-web-android-spec.md §4.1),
// using the original API of @react-native-google-signin. The Google id_token
// is exchanged once at /api/auth/google for an app session; when that session
// expires the client re-runs a silent Google sign-in. The web build resolves
// services/googleAuth.js instead (it has no Google sign-in).
import {
  GoogleSignin,
  isErrorWithCode,
  isNoSavedCredentialFoundResponse,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { apiFetch } from './apiClient.js';
import { loadByok, refreshCredits, resetAiAccess, setCredits } from './aiAccess.js';
import { isDemoMode } from './env.js';
import { getSessionToken, getUser, setSessionToken, setUser } from './storage.js';

if (!isDemoMode()) GoogleSignin.configure({ webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID });

export const googleSignInAvailable = !isDemoMode();

// AppDataContext mirrors the signed-in user; it subscribes here so a sign-in
// from anywhere (Perfil, the prompt before an AI call, session recovery)
// updates every screen.
const userListeners = new Set();

export function subscribeUser(listener) {
  userListeners.add(listener);
  return () => userListeners.delete(listener);
}

function applyUser(user) {
  setUser(user);
  userListeners.forEach((listener) => listener(user));
}

async function exchange(idToken) {
  const response = await apiFetch('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: idToken }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || 'Não foi possível entrar com o Google.'), { code: payload.code });
  setSessionToken(payload.session || null);
  setCredits(payload.creditsRemaining);
  return payload.user;
}

// Opens the Google account picker. Resolves to the signed-in user, or null
// when the user cancelled. Calls made while the picker is open share it: a
// Google id_token can be exchanged only once.
let pendingSignIn = null;

export function signIn() {
  if (!pendingSignIn) pendingSignIn = pickAccount().finally(() => { pendingSignIn = null; });
  return pendingSignIn;
}

async function pickAccount() {
  let idToken;
  try {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return null;
    idToken = response.data.idToken;
  } catch (error) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.IN_PROGRESS) return null;
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new Error('Atualize o Google Play Services para entrar.');
    }
    throw new Error('Não foi possível entrar com o Google.');
  }
  const user = await exchange(idToken);
  applyUser(user);
  await loadByok();
  refreshCredits();
  return user;
}

// Silent re-sign-in after the app session expires. Never prompts.
export async function refreshSession() {
  try {
    const response = await GoogleSignin.signInSilently();
    if (isNoSavedCredentialFoundResponse(response)) return false;
    applyUser(await exchange(response.data.idToken));
    return true;
  } catch {
    return false;
  }
}

// At launch: a user saved without a session (an older build, or a failed
// sign-in) is renewed silently or cleared, so Perfil never shows a signed-in
// account that cannot call the API.
export async function restoreSession() {
  if (!getUser() || getSessionToken()) return;
  if (!(await refreshSession())) signOutLocal();
}

// Clears the local session without touching Google (used when recovery fails).
export function signOutLocal() {
  setSessionToken(null);
  applyUser(null);
  resetAiAccess();
}

// The BYOK key stays in secure storage under the account, so signing back in
// with the same Google account brings it back.
export async function signOut() {
  try {
    await GoogleSignin.signOut();
  } catch {
    // The local sign-out below is what matters.
  }
  signOutLocal();
}
