import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { isIP } from 'node:net';
import analyzeImage from '../api/analyze-image.js';
import subjectAI from '../api/subject-ai.js';
import tts from '../api/tts.js';
import transcribe from '../api/transcribe.js';
import videoRecommendations from '../api/video-recommendations.js';
import authGoogle from '../api/auth/google.js';
import me from '../api/me.js';
import byokValidate from '../api/byok/validate.js';
import testerUnlock from '../api/tester/unlock.js';
import testerLock from '../api/tester/lock.js';
import { hasValidApiKey, isJsonContentType } from '../api/_lib/http.js';
import { hasValidTesterCookie } from '../api/_lib/tester.js';

const POST_ROUTES = {
  '/api/analyze-image': analyzeImage,
  '/api/subject-ai': subjectAI,
  '/api/tts': tts,
  '/api/transcribe': transcribe,
  '/api/video-recommendations': videoRecommendations,
  '/api/auth/google': authGoogle,
  '/api/byok/validate': byokValidate,
  '/api/tester/unlock': testerUnlock,
  '/api/tester/lock': testerLock,
};

// Routes the web build calls before it has a tester cookie; they carry no API key.
const NO_API_KEY_ROUTES = new Set(['/api/tester/unlock', '/api/tester/lock']);

const GET_ROUTES = {
  '/api/me': me,
};

// Same cap as api/_lib/guard.js, so local and Vercel reject the same bodies.
const MAX_BODY_BYTES = 4_000_000;

function sendJson(response, statusCode, payload) {
  if (response.writableEnded) return;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

// DNS rebinding makes an attacker's page same-origin with this server (its
// domain resolves to 127.0.0.1), which defeats the JSON content-type guard.
// The Host header still carries the attacker's name, so only IP literals,
// localhost and explicitly configured names (JOVI_ALLOWED_HOSTS, e.g. the
// deployed domain) are served.
function isAllowedHost(hostHeader, allowed) {
  const host = String(hostHeader || '').trim().toLowerCase();
  let name;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end === -1) return false;
    name = host.slice(1, end);
  } else {
    name = host.split(':')[0];
  }
  if (!name) return false;
  if (name === 'localhost' || isIP(name)) return true;
  return allowed.has(name);
}

// Rejected requests are answered without buffering their body; the socket is
// closed once the body passes the normal size cap. Unbounded draining kept
// anyone's upload running (536 MB in a test); cutting at a few KB made clients
// that upload before reading (Android's OkHttp) see "no connection" instead
// of the 403/415/401 that explains the problem.
function discardBody(request, response, limit = MAX_BODY_BYTES) {
  response.setHeader('Connection', 'close');
  let seen = 0;
  request.on('data', (chunk) => {
    seen += chunk.length;
    if (seen > limit) request.destroy();
  });
  request.resume();
}

function tooLarge() {
  return Object.assign(new Error('Request body too large.'), { statusCode: 413 });
}

// An oversized body is drained (not buffered) and answered with 413; destroying
// the socket used to turn it into a connection reset with no response and no
// log line. A body far past the limit is cut off to bound the work. The raw
// bytes are kept: the guard hashes them for the Play Integrity request hash
// and parses the JSON itself (same code path as on Vercel).
function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(request.headers['content-length'] || 0);
    if (contentLength > MAX_BODY_BYTES) {
      // Answered right away; the client may keep sending, so cap what is read.
      let seen = 0;
      request.on('data', (chunk) => { seen += chunk.length; if (seen > MAX_BODY_BYTES) request.destroy(); });
      request.resume();
      reject(tooLarge());
      return;
    }

    const chunks = [];
    let size = 0;
    let overflow = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES * 4) { request.destroy(); return; }
      if (size > MAX_BODY_BYTES) { overflow = true; chunks.length = 0; return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (overflow) { reject(tooLarge()); return; }
      resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

function createResponseAdapter(response) {
  const adapter = {
    statusCode: 200,
    status(code) {
      adapter.statusCode = code;
      return adapter;
    },
    json(payload) {
      sendJson(response, adapter.statusCode, payload);
      return adapter;
    },
    setHeader(name, value) {
      if (!response.headersSent) response.setHeader(name, value);
      return adapter;
    },
  };
  return adapter;
}

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

// Serves the Expo web export from JOVI_WEB_DIST on the API's own origin, the
// way Vercel does in production (prod-web-android-spec.md §3.1), so the tester
// cookie flow can be tried locally. Unknown paths get index.html (SPA routes).
async function serveStatic(response, distDir, path) {
  const root = normalize(distDir);
  let file = normalize(join(root, decodeURIComponent(path)));
  if (file !== root && !file.startsWith(root + sep)) {
    sendJson(response, 403, { message: 'Caminho inválido.' });
    return;
  }
  let body;
  try {
    body = await readFile(file);
  } catch {
    file = join(root, 'index.html');
    body = await readFile(file).catch(() => null);
  }
  if (!body) {
    sendJson(response, 404, { message: 'Build web não encontrado em JOVI_WEB_DIST.' });
    return;
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', STATIC_TYPES[extname(file)] || 'application/octet-stream');
  response.end(body);
}

// One JSON line per request: enough to correlate a client error (the app can
// show the X-Request-Id) with the server-side failure without logging bodies.
function defaultLog(entry) {
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  if (entry.status >= 500) console.error(line);
  else console.log(line);
}

export function createLocalApiServer({ webUrl = process.env.JOVI_WEB_URL || 'http://127.0.0.1:5173', webDist = process.env.JOVI_WEB_DIST || '', log = defaultLog } = {}) {
  const allowedHosts = new Set(String(process.env.JOVI_ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
  return http.createServer(async (request, response) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const path = (request.url || '').split('?')[0];
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Request-Id', requestId);
    response.on('finish', () => {
      if (path.startsWith('/api/')) log({ level: response.statusCode >= 500 ? 'error' : 'info', requestId, method: request.method, path, status: response.statusCode, ms: Date.now() - startedAt });
    });

    if (!isAllowedHost(request.headers.host, allowedHosts)) {
      discardBody(request, response);
      sendJson(response, 403, { message: 'Host não permitido.' });
      return;
    }

    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (webDist && request.method === 'GET' && !path.startsWith('/api/')) {
      await serveStatic(response, webDist, path === '/' ? '/index.html' : path);
      return;
    }

    if (request.method === 'GET' && (path === '/gallery' || path === '/camera')) {
      response.statusCode = 302;
      response.setHeader('Location', `${webUrl}${path}`);
      response.end();
      return;
    }

    const routeMethod = POST_ROUTES[path] ? 'POST' : GET_ROUTES[path] ? 'GET' : null;
    if (!routeMethod) {
      sendJson(response, 404, { message: 'Rota local não encontrada.' });
      return;
    }
    if (request.method !== routeMethod) {
      discardBody(request, response);
      response.setHeader('Allow', routeMethod);
      sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.' });
      return;
    }
    const handler = routeMethod === 'POST' ? POST_ROUTES[path] : GET_ROUTES[path];
    if (routeMethod === 'POST' && !isJsonContentType(request.headers['content-type'])) {
      discardBody(request, response);
      sendJson(response, 415, { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Tipo de conteúdo não suportado.' });
      return;
    }

    // ip comes from the socket, not a spoofable header — used as the rate-limit key.
    const context = { method: request.method, headers: request.headers, url: request.url, ip: request.socket?.remoteAddress };
    const authorized = hasValidApiKey(context) || hasValidTesterCookie(context) || NO_API_KEY_ROUTES.has(path);
    // A caller without the shared key is answered from headers alone: the
    // handler's guard replies 401/429 (and counts the failure) without anyone
    // making this server buffer and parse up to 11 MB first.
    try {
      if (routeMethod === 'GET' || !authorized) {
        if (routeMethod === 'POST') discardBody(request, response);
        await handler({ ...context, body: {}, rawBody: Buffer.alloc(0) }, createResponseAdapter(response));
        return;
      }
      const rawBody = await readRawBody(request);
      let body;
      try {
        body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
      } catch {
        body = undefined; // the guard answers 400 INVALID_JSON from rawBody
      }
      await handler({ ...context, body, rawBody }, createResponseAdapter(response));
    } catch (error) {
      const tooLargeBody = error?.statusCode === 413;
      sendJson(response, tooLargeBody ? 413 : 500, tooLargeBody
        ? { code: 'PAYLOAD_TOO_LARGE', message: 'Arquivo grande demais para enviar.', requestId }
        : { message: 'Erro interno na API local.', requestId });
      if (!tooLargeBody) console.error('JOVI Lens local API failed', { requestId, code: error?.code || 'LOCAL_API_ERROR' });
    }
  });
}
