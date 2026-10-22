import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createLocalApiServer } from '../server/app.js';

const ORIGINAL_ENV = { ...process.env };

async function withServer(run, env = {}) {
  process.env.JOVI_LENS_DEMO_MODE = 'true';
  // Local dev path: no Google session needed (see api/_lib/guard.js step 6).
  process.env.JOVI_LOCAL_DEV_BYPASS = 'true';
  delete process.env.JOVI_API_KEY;
  delete process.env.VERCEL;
  Object.assign(process.env, env);
  const server = createLocalApiServer({ log: () => {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.close();
    process.env = { ...ORIGINAL_ENV };
  }
}

const SUBJECT_BODY = JSON.stringify({ action: 'questions', subject: { name: 'História', notes: [{ title: 'x', summary: 'y' }] } });

test('POST bodies must be exactly application/json (CSRF simple-request guard)', async () => {
  await withServer(async (base) => {
    const post = (headers) => fetch(`${base}/api/subject-ai`, { method: 'POST', headers, body: SUBJECT_BODY });
    assert.equal((await post({ 'Content-Type': 'application/json' })).status, 200);
    assert.equal((await post({ 'Content-Type': 'application/json; charset=utf-8' })).status, 200);
    // Both of these reach a server with no CORS preflight from a browser.
    assert.equal((await post({ 'Content-Type': 'text/plain;application/json' })).status, 415);
    assert.equal((await post({ 'Content-Type': 'text/plain' })).status, 415);
    const noType = await fetch(`${base}/api/subject-ai`, { method: 'POST', body: new Blob([SUBJECT_BODY]) });
    assert.equal(noType.status, 415);
  });
});

test('known routes answer 405 with Allow for the wrong method, unknown routes 404', async () => {
  await withServer(async (base) => {
    const wrongMethod = await fetch(`${base}/api/analyze-image`);
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'POST');
    const getOnly = await fetch(`${base}/api/me`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(getOnly.status, 405);
    assert.equal(getOnly.headers.get('allow'), 'GET');
    assert.equal((await fetch(`${base}/api/nao-existe`, { method: 'POST' })).status, 404);
  });
});

test('oversized bodies get a 413 with the payload code', async () => {
  await withServer(async (base) => {
    const huge = JSON.stringify({ audio: 'A'.repeat(12_000_000) });
    const response = await fetch(`${base}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: huge });
    assert.equal(response.status, 413);
    const payload = await response.json();
    assert.equal(payload.code, 'PAYLOAD_TOO_LARGE');
    assert.match(payload.message, /grande demais/i);
  });
});

test('every response carries a request id for log correlation', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/subject-ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: SUBJECT_BODY });
    assert.match(response.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/);
  });
});

test('requests addressed to a foreign Host are refused (DNS rebinding)', async () => {
  await withServer(async (base) => {
    const { port } = new URL(base);
    const { request } = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/api/subject-ai', method: 'POST', headers: { Host: `attacker.example:${port}`, 'Content-Type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end(SUBJECT_BODY);
    });
    assert.equal(status, 403);
    assert.equal((await fetch(`${base}/api/subject-ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: SUBJECT_BODY })).status, 200);
  });
});

test('a wrong API key is rejected before the (possibly huge) body is read', async () => {
  await withServer(async (base) => {
    // Invalid JSON: parsing it first would answer 400; checking the key first answers 401.
    const response = await fetch(`${base}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'errada' }, body: `{${'x'.repeat(1_000_000)}` });
    assert.equal(response.status, 401);
  }, { JOVI_API_KEY: 'chave-certa' });
});

test('an oversized chunked body gets a 413 answer instead of a reset', async () => {
  await withServer(async (base) => {
    const { port } = new URL(base);
    const { request } = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/api/transcribe', method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      const chunk = 'A'.repeat(1_000_000);
      req.write('{"audio":"');
      for (let i = 0; i < 12; i += 1) req.write(chunk);
      req.end('"}');
    });
    assert.equal(status, 413);
  });
});

test('web tester flow: unlock without an API key, then AI calls ride on the cookie', async () => {
  await withServer(async (base) => {
    const unlocked = await fetch(`${base}/api/tester/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'jovi-2026' }) });
    assert.equal(unlocked.status, 200);
    const cookie = unlocked.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${base}/api/subject-ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: SUBJECT_BODY });
    assert.equal(response.status, 200);
    const without = await fetch(`${base}/api/subject-ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: SUBJECT_BODY });
    assert.equal(without.status, 401);
  }, { JOVI_API_KEY: 'chave-certa', JOVI_LOCAL_DEV_BYPASS: 'false', JOVI_TESTER_KEY: 'k'.repeat(64), JOVI_TESTER_ACCESS_CODE: 'jovi-2026' });
});
