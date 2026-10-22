import { defineRoute } from '../_lib/guard.js';
import { clearTesterCookie } from '../_lib/tester.js';

export const config = { api: { bodyParser: false } };

// Ends this browser's tester access by clearing the cookie.
export default defineRoute({
  method: 'POST',
  scope: 'tester-lock',
  burstPerMinute: 10,
  auth: 'none',
  apiKey: false,
  cost: 0,
  byok: 'forbidden',
  run: async (_input, ctx) => {
    ctx.res.setHeader('Set-Cookie', clearTesterCookie());
    return { tester: false };
  },
});
