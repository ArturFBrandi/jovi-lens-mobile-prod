// Web build: BYOK is Android-only (prod-web-android-spec.md §4.5), so no key is
// ever stored in the browser.
export async function readSecret() {
  return null;
}

export async function writeSecret() {
  throw new Error('Chave própria disponível apenas no app Android.');
}

export async function deleteSecret() {}
