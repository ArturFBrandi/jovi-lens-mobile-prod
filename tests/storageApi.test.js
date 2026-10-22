import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression: react-native-mmkv v4 renamed delete() to remove(). The old call
// threw inside a try/catch, so "Sair" left the session token and the account
// on the phone and the user was signed back in on the next launch.
test('storage removes keys with the MMKV v4 API', () => {
  const source = readFileSync(new URL('../services/storage.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bstorage\.delete\(/);
  assert.match(source, /storage\.remove\(SESSION_KEY\)/);
});
