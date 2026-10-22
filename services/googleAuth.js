import { useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import { apiFetch } from './apiClient.js';
import { setSessionToken } from './storage.js';

// Browser-based OAuth (expo-auth-session), not the native Google Sign-In SDK
// Google has deprecated in favor of Android Credential Manager — that native
// path needs a config plugin, an EAS development build, and an Android OAuth
// client with the app's keystore SHA-1 registered, none of which exist yet.
// This flow requests an id_token directly via the OpenID Connect implicit
// flow, so there is no code-exchange step and therefore no client secret to
// protect on-device — see auth-plan.md Phase 2 for the full writeup and what
// to try in Google Cloud Console for EXPO_PUBLIC_GOOGLE_CLIENT_ID. Not
// verified against a live Google consent screen — no way to click through
// OAuth in this environment; test the actual round trip once a client id is
// set.
const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

export function useGoogleSignIn() {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
  const [nonce] = useState(() => `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`);
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      redirectUri: AuthSession.makeRedirectUri({ scheme: 'jovilens' }),
      responseType: AuthSession.ResponseType.IdToken,
      scopes: ['openid', 'profile', 'email'],
      extraParams: { nonce },
    },
    discovery
  );

  async function signIn() {
    if (!clientId) throw new Error('Login com Google ainda não está configurado.');
    const result = await promptAsync();
    if (result.type === 'dismiss' || result.type === 'cancel') return null;
    if (result.type !== 'success') throw new Error('Não foi possível entrar com o Google.');
    const idToken = result.params?.id_token;
    if (!idToken) throw new Error('O Google não retornou uma credencial válida.');

    const response = await apiFetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The server checks this against the id_token's nonce claim — it binds the
      // token to this sign-in (injection guard); replay is blocked server-side.
      body: JSON.stringify({ credential: idToken, nonce }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Não foi possível entrar com o Google.');
    setSessionToken(payload.session || null);
    return payload.user;
  }

  return { signIn, configured: Boolean(clientId), ready: Boolean(request) };
}

export function signOutGoogle() {
  setSessionToken(null);
}
