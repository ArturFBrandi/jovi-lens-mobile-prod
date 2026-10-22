import test from 'node:test';
import assert from 'node:assert/strict';
import subjectAI from '../api/subject-ai.js';
import tts from '../api/tts.js';
import me from '../api/me.js';
import unlock from '../api/tester/unlock.js';
import lock from '../api/tester/lock.js';
import { missingRequiredEnv } from '../api/_lib/guard.js';
import { resetMemoryStore } from '../api/_lib/store.js';
import { issueTesterCookie } from '../api/_lib/tester.js';
import { BASE_ENV, makeReq, makeRes, withEnv } from './helpers/http.js';

const TESTER_ENV = {
  JOVI_TESTER_KEY: 'k'.repeat(64),
  JOVI_TESTER_ACCESS_CODE: 'jovi-2026',
  JOVI_TESTER_DAILY_CAP: undefined,
  JOVI_API_KEY: 'shared-app-key',
  JOVI_LENS_DEMO_MODE: 'true',
};

const QUESTIONS = { action: 'questions', subject: { name: 'História', notes: [{ title: 'Revolução Industrial', text: 'fábricas' }] } };

function cookieFrom(setCookie) {
  return String(setCookie).split(';')[0];
}

async function call(handler, options) {
  const res = makeRes();
  await handler(makeReq(options), res);
  return res;
}

function testerTest(name, fn, env = {}) {
  test(name, () => withEnv({ ...BASE_ENV, ...TESTER_ENV, ...env }, async () => {
    resetMemoryStore();
    await fn();
  }));
}

async function unlockCookie() {
  const res = await call(unlock, { url: '/api/tester/unlock', body: { code: 'jovi-2026' } });
  assert.equal(res.statusCode, 200);
  return cookieFrom(res.headers['set-cookie']);
}

testerTest('unlock with the right code sets an HttpOnly, SameSite=Strict cookie without an API key', async () => {
  const res = await call(unlock, { url: '/api/tester/unlock', body: { code: 'jovi-2026' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { tester: true });
  const header = res.headers['set-cookie'];
  assert.match(header, /^jovi_tester=\d+\.[\w-]+;/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\/api/);
});

testerTest('a wrong code is 401, and the 11th failure in an hour is rate limited even with the right code', async () => {
  for (let i = 0; i < 10; i += 1) {
    const res = await call(unlock, { url: '/api/tester/unlock', body: { code: 'wrong' } });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'TESTER_CODE_INVALID');
  }
  const blocked = await call(unlock, { url: '/api/tester/unlock', body: { code: 'jovi-2026' } });
  assert.equal(blocked.body.code, 'RATE_LIMITED');
});

testerTest('unlock is refused when tester access is not configured', async () => {
  const res = await call(unlock, { url: '/api/tester/unlock', body: { code: 'jovi-2026' } });
  assert.equal(res.body.code, 'TESTER_CODE_INVALID');
}, { JOVI_TESTER_KEY: undefined });

testerTest('a valid tester cookie skips API key, session and credits', async () => {
  const cookie = await unlockCookie();
  for (let i = 0; i < 5; i += 1) {
    const res = await call(subjectAI, { url: '/api/subject-ai', headers: { cookie }, body: QUESTIONS });
    assert.equal(res.statusCode, 200, `call ${i + 1}`);
    assert.equal(res.headers['x-jovi-credits-remaining'], undefined);
  }
});

testerTest('without the cookie the normal path applies (API key, then session)', async () => {
  const noKey = await call(subjectAI, { url: '/api/subject-ai', body: QUESTIONS });
  assert.equal(noKey.body.code, 'API_KEY_INVALID');
  const noSession = await call(subjectAI, { url: '/api/subject-ai', headers: { 'x-api-key': 'shared-app-key' }, body: QUESTIONS });
  assert.equal(noSession.body.code, 'SIGN_IN_REQUIRED');
});

testerTest('tampered, expired or pre-code-change cookies fall back to the normal path', async () => {
  const cookie = await unlockCookie();
  const tampered = `${cookie.slice(0, -2)}xx`;
  const expired = cookieFrom(issueTesterCookie(Date.now() - 13 * 60 * 60 * 1000));
  for (const bad of [tampered, expired]) {
    const res = await call(subjectAI, { url: '/api/subject-ai', headers: { cookie: bad, 'x-api-key': 'shared-app-key' }, body: QUESTIONS });
    assert.equal(res.body.code, 'SIGN_IN_REQUIRED');
  }
  process.env.JOVI_TESTER_ACCESS_CODE = 'new-campaign';
  const revoked = await call(subjectAI, { url: '/api/subject-ai', headers: { cookie, 'x-api-key': 'shared-app-key' }, body: QUESTIONS });
  assert.equal(revoked.body.code, 'SIGN_IN_REQUIRED');
});

testerTest('the global daily cap stops tester calls with 429 TESTER_CAP_REACHED', async () => {
  const cookie = await unlockCookie();
  for (let i = 0; i < 3; i += 1) assert.equal((await call(subjectAI, { url: '/api/subject-ai', headers: { cookie }, body: QUESTIONS })).statusCode, 200);
  const capped = await call(subjectAI, { url: '/api/subject-ai', headers: { cookie }, body: QUESTIONS });
  assert.equal(capped.statusCode, 429);
  assert.equal(capped.body.code, 'TESTER_CAP_REACHED');
}, { JOVI_TESTER_DAILY_CAP: '3' });

testerTest('tts does not require BYOK for a tester (server provider)', async () => {
  const cookie = await unlockCookie();
  const res = await call(tts, { url: '/api/tts', headers: { cookie }, body: { text: 'Olá' } });
  assert.notEqual(res.body?.code, 'BYOK_REQUIRED');
});

testerTest('/api/me reports tester access; lock clears the cookie', async () => {
  const cookie = await unlockCookie();
  const res = await call(me, { method: 'GET', url: '/api/me', headers: { cookie } });
  assert.deepEqual(res.body, { tester: true });
  const locked = await call(lock, { url: '/api/tester/lock', headers: { cookie }, body: {} });
  assert.match(locked.headers['set-cookie'], /^jovi_tester=;.*Max-Age=0/);
});

testerTest('logs never contain the code, the cookie or the key', async () => {
  const lines = [];
  const original = { log: console.log, error: console.error };
  console.log = (line) => lines.push(String(line));
  console.error = (line) => lines.push(String(line));
  let cookie;
  try {
    await call(unlock, { url: '/api/tester/unlock', body: { code: 'wrong' } });
    cookie = await unlockCookie();
    await call(subjectAI, { url: '/api/subject-ai', headers: { cookie }, body: QUESTIONS });
  } finally {
    Object.assign(console, original);
  }
  const joined = lines.join('\n');
  assert.ok(joined.includes('"tester":true'));
  for (const secret of ['jovi-2026', 'k'.repeat(64), cookie.split('=')[1]]) assert.ok(!joined.includes(secret));
});

test('Play Integrity variables are only required when integrity is on (D8)', () => withEnv({
  ...BASE_ENV,
  VERCEL: '1',
  AI_PROVIDER: 'gemini',
  GEMINI_API_KEY: 'g',
  GOOGLE_CLIENT_ID: 'c',
  JOVI_SESSION_SECRET: 's',
  JOVI_API_KEY: 'a',
  KV_REST_API_URL: 'https://kv',
  KV_REST_API_TOKEN: 't',
  JOVI_REQUIRE_INTEGRITY: undefined,
  PLAY_INTEGRITY_PROJECT_NUMBER: undefined,
}, () => {
  assert.deepEqual(missingRequiredEnv(), []);
  process.env.JOVI_REQUIRE_INTEGRITY = 'true';
  assert.ok(missingRequiredEnv().includes('PLAY_INTEGRITY_PROJECT_NUMBER'));
}));
