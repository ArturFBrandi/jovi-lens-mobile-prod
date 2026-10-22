// Web tester access (prod-web-android-spec.md §3.2). Testers unlock with a
// shared access code and receive a signed HttpOnly cookie; the guard treats a
// valid cookie as unlimited access. The signing key (JOVI_TESTER_KEY) never
// leaves the server, and the cookie is bound to the current access code, so
// changing JOVI_TESTER_ACCESS_CODE revokes every cookie at once.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const TESTER_COOKIE = 'jovi_tester';
const COOKIE_TTL_SEC = 12 * 60 * 60;
const DEFAULT_DAILY_CAP = 3000;

function testerKey() {
  const key = String(process.env.JOVI_TESTER_KEY || '');
  return key.length >= 32 ? key : '';
}

function accessCode() {
  return String(process.env.JOVI_TESTER_ACCESS_CODE || '').trim();
}

export function testerEnabled() {
  return Boolean(testerKey() && accessCode());
}

// Total tester AI calls allowed per UTC day across all testers.
export function testerDailyCap() {
  const n = Number(process.env.JOVI_TESTER_DAILY_CAP || DEFAULT_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isValidAccessCode(code) {
  return testerEnabled() && typeof code === 'string' && safeEqual(code.trim(), accessCode());
}

function codeVersion() {
  return createHash('sha256').update(accessCode()).digest('hex').slice(0, 16);
}

function sign(expiresAt) {
  return createHmac('sha256', testerKey()).update(`${expiresAt}.${codeVersion()}`).digest('base64url');
}

function cookieAttributes(maxAge) {
  // Secure everywhere but local http (the dev server); Chrome accepts Secure on
  // http://localhost anyway, but other local hosts would drop the cookie.
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function issueTesterCookie(now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + COOKIE_TTL_SEC;
  return `${TESTER_COOKIE}=${expiresAt}.${sign(expiresAt)}${cookieAttributes(COOKIE_TTL_SEC)}`;
}

export function clearTesterCookie() {
  return `${TESTER_COOKIE}=${cookieAttributes(0)}`;
}

function readCookie(req, name) {
  const header = String(req.headers?.cookie || '');
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

// True for an unexpired cookie signed with the current key and access code.
export function hasValidTesterCookie(req, now = Date.now()) {
  if (!testerEnabled()) return false;
  const [expiresAt, signature] = readCookie(req, TESTER_COOKIE).split('.');
  if (!expiresAt || !signature || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) * 1000 <= now) return false;
  return safeEqual(signature, sign(expiresAt));
}
