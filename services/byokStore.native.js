// The user's own AI key lives only in the Android keystore-backed secure store.
import * as SecureStore from 'expo-secure-store';

export async function readSecret(key) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function writeSecret(key, value) {
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecret(key) {
  await SecureStore.deleteItemAsync(key).catch(() => {});
}
