// Request pipeline shared by every API route (prod-implementation-spec.md §4
// and §5.3). Handlers declare what they need with defineRoute(); the guard
// enforces method, body limits, API key, tester access, BYOK headers, session,
// integrity, rate limits, idempotency and credits before calling `run`.
import { createHash } from 'node:crypto';
import { verifyIntegrity } from './attestation.js';
import { errorBody, errorResponse, hasValidApiKey, ipKey, isJsonContentType, sessionUser } from './http.js';
import { log, logError, userHash } from './log.js';
import { getStore } from './store.js';
import { hasValidTesterCookie, testerDailyCap } from './tester.js';
import { getProviderByName } from './ai/providers/index.js';

const MAX_BODY_BYTES = 4_000_000;
const API_KEY_FAIL_LIMIT = 20;
const IDEMPOTENCY_TTL_SEC = 600;
const BYOK_PROVIDERS = new Set(['gemini', 'openai', 'minimax']);
const BYOK_KEY_PATTERN = /^[A-Za-z0-9._-]{20,300}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Variables that must be present on Vercel; any missing one makes every route
// fail closed with 503 SERVER_MISCONFIGURED (§3.1).
const REQUIRED_IN_PROD = [
  'AI_PROVIDER',
  'GOOGLE_CLIENT_ID',
  'JOVI_SESSION_SECRET',
  'JOVI_API_KEY',
];

// Play Integrity is off for this release (prod-web-android-spec.md D8); its
// variables are only required once JOVI_REQUIRE_INTEGRITY=true turns it on.
const REQUIRED_WITH_INTEGRITY = [
  'PLAY_INTEGRITY_PROJECT_NUMBER',
  'PLAY_INTEGRITY_CERT_SHA256',
  'PLAY_INTEGRITY_SA_JSON_B64',
];

// The server key(s) the provider named by AI_PROVIDER needs to serve free
// users; each entry is a list of alternatives (the Azure adapter accepts
// either deployment variable). An unknown provider is reported as missing.
const PROVIDER_ENV = {
  gemini: [['GEMINI_API_KEY']],
  minimax: [['MINIMAX_API_KEY']],
  openai: [['OPENAI_API_KEY']],
  'azure-openai': [['AZURE_OPENAI_ENDPOINT'], ['AZURE_OPENAI_API_KEY'], ['AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_DEPLOYMENT_NAME']],
};

export function missingRequiredEnv() {
  if (!process.env.VERCEL) return [];
  const required = process.env.JOVI_REQUIRE_INTEGRITY === 'true' ? [...REQUIRED_IN_PROD, ...REQUIRED_WITH_INTEGRITY] : REQUIRED_IN_PROD;
  const missing = required.filter((name) => !process.env[name]);
  const provider = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (provider && !PROVIDER_ENV[provider]) missing.push(`AI_PROVIDER (desconhecido: ${provider})`);
  for (const options of PROVIDER_ENV[provider] || []) {
    if (!options.some((name) => process.env[name])) missing.push(options.join('/'));
  }
  const hasUpstash = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
  const hasKv = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
  if (!hasUpstash && !hasKv) missing.push('KV_REST_API_URL/KV_REST_API_TOKEN');
  return missing;
}

const startupMissing = missingRequiredEnv();
if (startupMissing.length) logError('server_misconfigured', { missing: startupMissing });

export function freeCredits() {
  const n = Number(process.env.JOVI_FREE_CREDITS || 3);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3;
}

export function sha256hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function clientIp(req) {
  if (process.env.VERCEL) return ipKey(req.headers['x-real-ip'] || 'unknown');
  return ipKey(req.ip || 'unknown');
}

// Fixed-window rate-limit key: rl:{scope}:{id}:{windowIndex}.
export function rateKey(scope, id, windowSec) {
  return `rl:${scope}:${id}:${Math.floor(Date.now() / 1000 / windowSec)}`;
}

let bypassWarned = false;
function devBypassActive() {
  const active = process.env.JOVI_LOCAL_DEV_BYPASS === 'true' && !process.env.VERCEL;
  if (active && !bypassWarned) {
    bypassWarned = true;
    console.warn('JOVI_LOCAL_DEV_BYPASS ativo — nunca use em produção');
  }
  return active;
}

function readRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) {
    return Promise.resolve(req.rawBody.length > MAX_BODY_BYTES ? null : req.rawBody);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (error) => { if (!done) { done = true; reject(error); } });
  });
}

function routePath(req) {
  return String(req.url || '').split('?')[0];
}

export function defineRoute({
  method,
  scope,
  burstPerMinute,
  auth,
  integrity = false,
  apiKey = true,
  cost = 0,
  byok = 'forbidden',
  byokCapability,
  validate,
  run,
}) {
  return async function handler(req, res) {
    const started = Date.now();
    const route = routePath(req) || (typeof scope === 'string' ? scope : 'unknown');
    const reqId = req.headers?.['x-vercel-id'] ? String(req.headers['x-vercel-id']).slice(0, 120) : undefined;
    const ip = clientIp(req);
    const ctx = { req, res, ip, user: null, byok: null, bypass: false, tester: false, log: null };
    ctx.log = (event, fields = {}) => log(event, { route, reqId, userHash: userHash(ctx.user?.sub), ...fields });

    let reserved = false;
    let idemKey = null;
    let store = null;

    const send = (status, payload) => {
      log('request', { route, status, code: status >= 400 ? payload?.code : undefined, ms: Date.now() - started, reqId, userHash: userHash(ctx.user?.sub), byok: Boolean(ctx.byok), tester: ctx.tester || undefined, ip: ctx.tester ? ip : undefined });
      return res.status(status).json(payload);
    };
    const fail = (code) => {
      const { status, message } = errorBody(code);
      return send(status, { code, message });
    };

    try {
      if (missingRequiredEnv().length) return fail('SERVER_MISCONFIGURED');

      // 1. Method.
      if (req.method !== method) return fail('METHOD_NOT_ALLOWED');

      // 2. Content type.
      if (method === 'POST' && !isJsonContentType(req.headers['content-type'])) return fail('UNSUPPORTED_MEDIA_TYPE');

      // 3. Raw body (hashed as received, for the integrity request hash).
      const raw = method === 'GET' ? Buffer.alloc(0) : await readRawBody(req);
      if (raw === null) return fail('PAYLOAD_TOO_LARGE');
      const bodySha256 = sha256hex(raw);
      let body = {};
      if (raw.length) {
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch {
          return fail('INVALID_JSON');
        }
      }

      store = getStore();

      // 4b. Web tester cookie (checked first: it stands in for the API key,
      // which the web build does not carry).
      ctx.tester = hasValidTesterCookie(req);

      // 4. API key. Only failures count toward the per-IP bucket.
      if (apiKey && !ctx.tester && process.env.JOVI_API_KEY && !hasValidApiKey(req)) {
        const failures = await store.hit(rateKey('apikeyfail', ip, 60), 60);
        return fail(failures > API_KEY_FAIL_LIMIT ? 'RATE_LIMITED' : 'API_KEY_INVALID');
      }

      // 5. BYOK headers. The key leaves req.headers immediately and only lives
      // in ctx.byok for the duration of this call.
      const byokProvider = String(req.headers['x-ai-provider'] || '').trim().toLowerCase();
      const byokKey = req.headers['x-ai-key'] === undefined ? '' : String(req.headers['x-ai-key']);
      delete req.headers['x-ai-key'];
      if (byokKey) {
        if (!byokProvider || !BYOK_PROVIDERS.has(byokProvider) || !BYOK_KEY_PATTERN.test(byokKey)) return fail('BYOK_INVALID_FORMAT');
        // Routes that never use a user key (auth, me) ignore a valid one.
        if (byok !== 'forbidden') ctx.byok = { provider: byokProvider, apiKey: byokKey };
      }

      // 6. Local-only dev bypass (keeps web/ working against the local server).
      ctx.bypass = devBypassActive();
      if (ctx.bypass) ctx.user = { sub: `dev:${ip}`, email: 'dev@local' };
      else if (ctx.tester) ctx.user = { sub: 'tester:web', email: 'tester@web' };
      // Both skip session, integrity, burst, the BYOK requirement and credits.
      const unlimited = ctx.bypass || ctx.tester;

      // 7. Session.
      if (auth === 'session' && !unlimited) {
        const { provided, user } = sessionUser(req);
        if (!provided) return fail('SIGN_IN_REQUIRED');
        if (!user) return fail('SESSION_INVALID');
        ctx.user = { sub: user.sub, email: user.email };
      }

      // 8. Integrity.
      if (integrity && !unlimited && process.env.JOVI_REQUIRE_INTEGRITY === 'true') {
        const verdict = await verifyIntegrity(req, bodySha256);
        if (!verdict.ok) return fail('INTEGRITY_FAILED');
      }

      // 9. Burst limit per user (or per IP for unauthenticated routes). A route
      // may pick its bucket from the body (subject-ai gives "grade" its own).
      // Testers share one identity, so they get the global daily cap instead.
      if (ctx.tester) {
        if (auth === 'session' && method === 'POST' && await store.hit(rateKey('testerday', 'all', 86400), 86400) > testerDailyCap()) return fail('TESTER_CAP_REACHED');
      } else {
        const id = ctx.user?.sub ?? ip;
        const bucket = typeof scope === 'function' ? scope(body) : scope;
        const burstLimit = typeof burstPerMinute === 'function' ? burstPerMinute(body) : burstPerMinute;
        if (await store.hit(rateKey(bucket, id, 60), 60) > burstLimit) return fail('RATE_LIMITED');
      }

      // 10. BYOK requirement (unlimited callers use the server provider).
      if (byok === 'required' && !(unlimited && !ctx.byok)) {
        if (!ctx.byok) return fail('BYOK_REQUIRED');
        if (byokCapability && !getProviderByName(ctx.byok.provider).capabilities?.[byokCapability]) return fail('BYOK_CAPABILITY_UNSUPPORTED');
      }

      // 11. Validate.
      let input = {};
      if (validate) {
        const validated = validate(body);
        if (validated?.error) {
          const { status, code, message } = validated.error;
          return send(status, { code, message });
        }
        input = validated.input;
      }

      const price = typeof cost === 'function' ? cost(body) : cost;
      const charged = price > 0 && !ctx.byok && !unlimited;

      // 12. Idempotency.
      if (charged) {
        const uuid = String(req.headers['idempotency-key'] || '');
        if (!UUID_V4_PATTERN.test(uuid)) return fail('IDEMPOTENCY_KEY_REQUIRED');
        const key = `idem:${ctx.user.sub}:${uuid.toLowerCase()}`;
        if (!(await store.setNX(key, 'pending', IDEMPOTENCY_TTL_SEC))) {
          const existing = await store.get(key);
          if (!existing || existing === 'pending') return fail('REQUEST_IN_PROGRESS');
          res.setHeader('x-jovi-idempotent-replay', 'true');
          return send(200, JSON.parse(existing));
        }
        idemKey = key;
      }

      // 13. Reserve a credit.
      let remaining = null;
      if (charged) {
        remaining = await store.reserveCredit(ctx.user.sub, freeCredits());
        if (remaining === -1) {
          await store.del(idemKey);
          idemKey = null;
          return fail('CREDITS_EXHAUSTED');
        }
        reserved = true;
      }

      // 14. Run.
      const result = await run(input, ctx);

      // 15. Success.
      if (reserved) {
        await store.set(idemKey, JSON.stringify(result), IDEMPOTENCY_TTL_SEC);
        res.setHeader('x-jovi-credits-remaining', String(remaining));
      } else if (ctx.user && !ctx.byok && !unlimited) {
        res.setHeader('x-jovi-credits-remaining', String(await store.getCredits(ctx.user.sub, freeCredits())));
      }
      return send(200, result);
    } catch (error) {
      if (store && reserved) await store.refundCredit(ctx.user.sub).catch(() => logError('refund_failed', { route, reqId }));
      if (store && idemKey) await store.del(idemKey).catch(() => {});

      let code = error?.code || 'AI_UNAVAILABLE';
      if (code === 'AI_PROVIDER_AUTH') {
        if (ctx.byok) code = 'BYOK_REJECTED';
        else {
          logError('server_provider_auth_failed', { route, reqId, status: error?.status });
          code = 'AI_UNAVAILABLE';
        }
      }
      const mapped = errorResponse({ code });
      logError('route_error', { route, reqId, code: mapped.code, status: error?.status, byok: Boolean(ctx.byok), tester: ctx.tester || undefined, userHash: userHash(ctx.user?.sub) });
      return send(mapped.status, { code: mapped.code, message: mapped.message });
    }
  };
}
