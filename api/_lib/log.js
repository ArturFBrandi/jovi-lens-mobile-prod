// Structured one-line JSON logs. Callers may only pass the allowed fields below:
// never headers, bodies, keys, tokens, emails, prompts or AI outputs. `ip` is
// only logged for web tester calls (prod-web-android-spec.md §3.2).
import { createHash } from 'node:crypto';

const ALLOWED_FIELDS = new Set(['route', 'code', 'status', 'ms', 'reqId', 'userHash', 'provider', 'model', 'reason', 'byok', 'missing', 'tester', 'ip']);

function pick(fields = {}) {
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => ALLOWED_FIELDS.has(key) && value !== undefined));
}

export function userHash(sub) {
  return sub ? createHash('sha256').update(String(sub)).digest('hex').slice(0, 12) : undefined;
}

export function log(event, fields) {
  console.log(JSON.stringify({ event, ...pick(fields) }));
}

export function logError(event, fields) {
  console.error(JSON.stringify({ event, ...pick(fields) }));
}
