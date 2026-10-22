import { Image } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Linking from 'expo-linking';
import { getDemoAction, getDemoAnalysis } from '../shared/demoResponses.js';
import { demoAssetModule } from './demoAssets.js';
import { isDemoMode } from './env.js';
import { apiFetch } from './apiClient.js';
import { rebaseMediaUri } from './storage.js';

function getImageSize(uri) {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

// Android's image loader (Fresco) rejects `data:` URIs with "Unsupported uri
// scheme for encoded image fetch!". Captures are stored as files now, but a
// data: URI can still arrive (web-shaped payloads, old records), so it is
// spilled to a cache file first — Image.getSize and ImageManipulator accept
// file:// URIs on every platform.
async function toLoadableUri(uri) {
  // A seeded sample's `/demo-assets/...` src names a bundled module, not a file
  // on disk, so Image.getSize and ImageManipulator both fail on it. expo-asset
  // materializes the module into the app's cache and hands back a real URI.
  const demoModule = demoAssetModule(uri);
  if (demoModule) {
    const asset = Asset.fromModule(demoModule);
    if (!asset.localUri) await asset.downloadAsync();
    return { uri: asset.localUri || asset.uri, cleanup: null };
  }
  if (typeof uri !== 'string' || !uri.startsWith('data:')) return { uri: rebaseMediaUri(uri), cleanup: null };
  const base64 = uri.slice(uri.indexOf(',') + 1);
  const target = `${FileSystem.cacheDirectory}jovi-ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });
  return { uri: target, cleanup: () => FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {}) };
}

// Web resizes on a <canvas> before upload. RN has no canvas — expo-image-manipulator
// does the resize+compress+base64 natively in one call, and (unlike the web version)
// takes the source URI directly, so there's no separate fetch-as-blob step for
// remote images either.
export async function prepareImageForAI(uri, maxSide = 1600) {
  const { uri: loadableUri, cleanup } = await toLoadableUri(uri);
  try {
    const { width, height } = await getImageSize(loadableUri);
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const result = await ImageManipulator.manipulateAsync(
      loadableUri,
      [{ resize: { width: targetWidth, height: targetHeight } }],
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    return `data:image/jpeg;base64,${result.base64}`;
  } finally {
    if (cleanup) await cleanup();
  }
}

function abortError() {
  return Object.assign(new Error('Operação cancelada.'), { name: 'AbortError' });
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => { clearTimeout(timer); reject(abortError()); });
  });
}

// Only these two read pixels; every follow-up works from the analysis the
// sheet already holds (see api/analyze-image.js IMAGE_ACTIONS).
const IMAGE_ACTIONS = new Set(['analyze', 'extract']);

async function requestAnalysis(src, { action = 'analyze', question = '', context = null, signal } = {}) {
  if (isDemoMode()) {
    await wait(action === 'analyze' ? 1100 : 520, signal);
    if (action === 'extract') return { text: getDemoAnalysis().text, language: 'pt', confidence: 0.96, provider: 'demo', model: 'jovi-lens-demo', mode: 'demo' };
    return action === 'analyze' ? { ...getDemoAnalysis(), provider: 'demo', model: 'jovi-lens-demo', mode: 'demo' } : getDemoAction({ action, question, context });
  }

  const payload = { action, question, context };
  if (IMAGE_ACTIONS.has(action) || !context) {
    const prepared = await prepareImageForAI(src, 1600);
    if (signal?.aborted) throw abortError();
    const [header, base64] = prepared.split(',');
    payload.image = base64;
    payload.mimeType = header.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';
  }

  let response;
  try {
    response = await apiFetch('/api/analyze-image', { method: 'POST', body: JSON.stringify(payload), signal });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
    throw new Error('Sem conexão no momento. Confira a internet ou ative o modo demonstração.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Não foi possível analisar a imagem.');
  return data;
}

export async function analyzeImage(src, options) {
  return requestAnalysis(src, options);
}

export async function extractText(src, options = {}) {
  return requestAnalysis(src, { ...options, action: 'extract' });
}

export async function requestStudyAction(src, options) {
  return requestAnalysis(src, options);
}

export { isDemoMode };

export function googleSearch(text) {
  const query = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 650);
  if (!query) return false;
  Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
  return true;
}

export async function copyText(text) {
  if (!text) return false;
  await Clipboard.setStringAsync(text);
  return true;
}
