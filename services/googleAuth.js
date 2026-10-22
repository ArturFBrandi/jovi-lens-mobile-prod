// Web build: there is no Google sign-in (testers use the access code, see
// services/testerAccess.js). The Android app resolves googleAuth.native.js.
import { setSessionToken, setUser } from './storage.js';

export const googleSignInAvailable = false;

export function subscribeUser() {
  return () => {};
}

export async function signIn() {
  throw new Error('Login com Google disponível apenas no app Android.');
}

export async function refreshSession() {
  return false;
}

export async function restoreSession() {}

export function signOutLocal() {
  setSessionToken(null);
  setUser(null);
}

export async function signOut() {
  signOutLocal();
}
