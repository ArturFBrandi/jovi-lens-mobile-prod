import { defineRoute, freeCredits } from './_lib/guard.js';
import { getStore } from './_lib/store.js';

export const config = { api: { bodyParser: false } };

export default defineRoute({
  method: 'GET',
  scope: 'me',
  burstPerMinute: 30,
  auth: 'session',
  integrity: false,
  cost: 0,
  byok: 'forbidden',
  run: async (_input, ctx) => (ctx.tester ? { tester: true } : {
    user: { id: ctx.user.sub, email: ctx.user.email },
    creditsRemaining: await getStore().getCredits(ctx.user.sub, freeCredits()),
    creditsTotal: freeCredits(),
  }),
});
