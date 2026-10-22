import { defineRoute, rateKey } from '../_lib/guard.js';
import { getStore } from '../_lib/store.js';
import { issueTesterCookie, isValidAccessCode } from '../_lib/tester.js';

export const config = { api: { bodyParser: false } };

const FAILURES_PER_HOUR = 10;

function routeError(code) {
  return Object.assign(new Error(code), { code });
}

function safeInput(body) {
  const code = typeof body?.code === 'string' ? body.code.slice(0, 100) : '';
  if (!code.trim()) return { error: { status: 400, code: 'INVALID_INPUT', message: 'Informe o código de acesso.' } };
  return { input: { code } };
}

// Exchanges the shared access code for the tester cookie (prod-web-android-spec.md §3.2).
// No API key: the web build does not carry one, and the code is the credential.
export default defineRoute({
  method: 'POST',
  scope: 'tester-unlock',
  burstPerMinute: 10,
  auth: 'none',
  apiKey: false,
  cost: 0,
  byok: 'forbidden',
  validate: safeInput,
  run: async ({ code }, ctx) => {
    const store = getStore();
    const failuresKey = rateKey('testerfail', ctx.ip, 3600);
    if (Number(await store.get(failuresKey) || 0) >= FAILURES_PER_HOUR) throw routeError('RATE_LIMITED');
    if (!isValidAccessCode(code)) {
      await store.hit(failuresKey, 3600);
      throw routeError('TESTER_CODE_INVALID');
    }
    ctx.res.setHeader('Set-Cookie', issueTesterCookie());
    return { tester: true };
  },
});
