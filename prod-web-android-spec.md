# Product spec — Web tester build + Android APK (`prod_app`)

Status: **approved** (2026-10-22; decisions in §9). Baseline: commit `30b8fd0` on `prod_app`. This is
the app UI reset to `main`'s demo look on top of the production backend.

This spec **supersedes** [`prod-implementation-spec.md`](prod-implementation-spec.md) and
[`prod-plan.md`](prod-plan.md) wherever they conflict. The biggest change is that **web now ships**.
**Play Integrity is dropped** (D8, §4.3). Backend details that this file doesn't change (the guard pipeline, sessions, store,
providers, logging) stay as written there. This file says *what* each product must be. Decisions are
recorded in §9 and referenced as D1–D7.

---

## 1. Products

| | **Web tester build** | **Android APK** | Presentation build (unchanged) |
|---|---|---|---|
| Audience | Many testers in a **monitored environment** | Testers who download and sideload the APK | Live pitches |
| Delivered as | Static Expo web export, served by the API's Vercel project | `com.jovilens.app`, EAS `production` profile | `com.jovilens.app.demo`, EAS `presentation` profile |
| AI | Real, through the production backend | Real, through the production backend | Offline demo responses |
| Access | **Tester key** in the server `.env`. Testers unlock with an access link/code (§3.2). No Google login | **Google sign-in required** | None |
| Limits | **None per tester.** Credits and sign-in are bypassed. Global cap of 3000 calls/day (D2) | **3 AI interactions per Google account**, for life. Unlimited with the user's own key (BYOK, D7) | — |
| Data | Starts empty (D5) | Starts empty (D5) | Seeded sample library |
| Codebase | Same Expo Router app (`app/`, `components/`, `services/`) | Same | Same |

There are two production products. They must have **the same features and the same appearance**. The
only differences allowed are listed in §2.2.

---

## 2. Parity

### 2.1 One codebase

- Both products are built from the **same React Native / Expo Router app**. Web uses
  `react-native-web`, which is already a dependency, through `npx expo export --platform web`.
- The old Vite client in `web/` is **retired**. It stops being a product and gets deleted in M5
  (§8).
- The visual reference is `main`'s demo app (commit `3cf5ac7`), which `prod_app` now matches
  exactly. Layout, colors, copy, tabs and navigation stay the same. A new screen or a restyle needs
  a spec change.
- Platform-specific code uses Expo's `.web.jsx` / `.native.jsx` split, which the camera tab already
  does (`app/(tabs)/camera.web.jsx`), or `Platform.OS` checks. Keep both to the minimum.

### 2.2 Allowed differences (the complete list)

| # | Area | Web | Android | Why |
|---|---|---|---|---|
| P1 | Access UI in Profile | "Acesso de teste" badge. No login card, no counter, no BYOK | "Entrar com Google" card. Signed in: avatar, email, "Sair", credits left, "Usar minha própria chave" | Different access models (§3, §4) |
| P2 | Running out of AI | Never happens (except the global cap, §3.2) | Shows the "Interações esgotadas" state (§4.4) | 3-credit cap |
| P3 | Camera | Browser camera / file picker (`camera.web.jsx`) | Native camera | Platform |
| P4 | Speech (podcast TTS, voice questions) | Server TTS/STT (D3) | On-device `expo-speech` / `expo-speech-recognition`. Server TTS/STT only with a BYOK key whose provider supports it | Cost control on the free tier |
| P5 | Access screen | One screen asking for the access code, shown until the tester cookie is valid (§3.2) | None | Protects the tester key |

Any other visible difference is a bug. The parity QA in §10 checks this.

### 2.3 What happens to `main`'s demo-only controls

`main` contains presentation scaffolding that has no meaning in a real product. Both production
builds handle it the same way:

| `main` element (Profile unless noted) | Web | Android |
|---|---|---|
| "Entrar como estudante" (fake login card) | Removed | Replaced in the same slot and style by "Entrar com Google" |
| JOVI Copilot card: "Testar por 7 dias · Demo", "Ativar acesso Copilot · Demo" | Card kept. Title "Acesso de teste", buttons removed | Card kept. Title "*N* de 3 interações restantes", buttons replaced by "Usar minha própria chave" (§4.5) |
| "Modo apresentação" / "Preparar demo" | Removed (presentation build only) | Removed (presentation build only) |
| "Calendário de provas" (fake Outlook connection) | Removed (D4) | Removed (D4) |
| Study-plan exam deadline (`CalendarDeadline`) | Hidden: no calendar is connected | Hidden: no calendar is connected |
| Sample library: seeded photos, notes, Estúdio artifacts | Not loaded (D5) | Not loaded (D5) |
| Empty tabs (consequence of D5) | Empty states in `main`'s existing dashed-box style (Galeria already has one; add Notas and Hoje) | Same |
| Staged pitch numbers on Hoje (`presentation` dashboard) | Off: real data only | Off: real data only |
| "Demo" labels in errors ("ative o modo demonstração…") | Real error text | Real error text |

The presentation build keeps all of `main`'s demo behavior, unchanged.

---

## 3. Web tester build

### 3.1 Hosting

- The **existing API Vercel project** serves the web build too. `vercel.json` changes
  `buildCommand` to export the Expo web app into `public/`, keeping `public/privacy.html`. Same
  origin means no CORS and no second project. The API's Production deployment stays public for the
  APK (prod spec H7). The static bundle holds no secret, so it needs no protection of its own.
- The web build calls the API on its own origin (`EXPO_PUBLIC_API_BASE_URL` empty → relative
  `/api/...`).
- SPA routing: Expo Router's web export with `web.output: "single"` in `app.json`, and a rewrite of
  non-`/api` paths to `index.html`.

### 3.2 Tester access (D1): the key stays on the server

The tester key **never reaches the browser**. Testers unlock with an access code and receive a
signed, `HttpOnly` cookie. That cookie is what bypasses the limits.

**Server secrets** (API project `.env`):
- `JOVI_TESTER_KEY`: 64 hex chars (`openssl rand -hex 32`). It signs tester cookies. Unset means
  tester access is off.
- `JOVI_TESTER_ACCESS_CODE`: the code handed out to testers (for example 8–12 characters). It's
  separate from the key, so it can be short and spoken out loud.

**Unlock flow.**
1. The tester opens `https://<domain>/?acesso=<code>` (the distributed link) or types the code on the
   web-only access screen (P5).
2. The web app calls `POST /api/tester/unlock` with `{ code }` and then removes `acesso` from the URL
   (`history.replaceState`).
3. The server compares `code` to `JOVI_TESTER_ACCESS_CODE` in constant time. A wrong code returns
   `401 TESTER_CODE_INVALID` and counts toward a per-IP failure bucket (10 failures/hour →
   `429 RATE_LIMITED`).
4. On success, the server sets the cookie
   `jovi_tester=<expiresAt>.<hmac(JOVI_TESTER_KEY, expiresAt + codeVersion)>` with
   `HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=43200` (12 h). `codeVersion` is a short
   hash of the current access code, so **changing the code invalidates every cookie**.
5. `GET /api/me` with a valid cookie returns `{ tester: true }`. The web app shows the access screen
   until that's true, and again if the cookie expires.

**Guard.** A new step 4b runs right after step 4 (API key). If the `jovi_tester` cookie verifies and
hasn't expired, then `ctx.tester = true` and `ctx.user = { sub: 'tester:web', email: 'tester@web' }`.
An invalid or expired cookie is ignored, so the request continues down the normal path and fails
there with `SIGN_IN_REQUIRED`, which the web app maps to the access screen.

With `ctx.tester = true`, the guard **skips** session (7), the per-user burst limit (9),
the BYOK requirement (10) and credit reservation (13). TTS and transcription use the **server**
provider, the same as the local dev bypass. Idempotency (12) still runs, because it prevents double
charges on retries. Because the cookie is `SameSite=Strict` and bound to the same origin, other sites
can't use it.

**Safety rails.**
- **Global daily cap (D2):** `JOVI_TESTER_DAILY_CAP=3000` total tester AI calls per UTC day
  (`store.hit('tester:day:'+utcDate, 86400)`). Above it, calls return `429 TESTER_CAP_REACHED`,
  shown as "Limite diário de testes atingido. Tente amanhã." Calls that cost nothing on Android
  (grading, TTS, STT) count too, because they cost money on the server.
- **Logging.** Every tester call logs `tester=true`, the route and the IP. It never logs the code,
  the cookie or the key.
- **Revocation.** Change `JOVI_TESTER_ACCESS_CODE` and redeploy (env change): all cookies die. Rotate
  `JOVI_TESTER_KEY` too if there's any suspicion it leaked. Change the code after every test
  campaign. Document this in the README runbook.

Residual risk, accepted: someone with a valid code can share it. The cap, the per-campaign code
changes and the monitored environment bound the damage.

### 3.3 Web-specific work

- Make every screen render and work in Chrome (desktop and mobile widths): camera (`camera.web.jsx`),
  gallery import (`expo-image-picker` on web), podcast and lesson audio playback (`expo-audio` on
  web), storage (MMKV falls back to `localStorage` on web, so verify that), sharing, and
  `services/confirm.js` (which already has a web path).
- Native-only modules (`@react-native-google-signin`, `expo-notifications`, `modules/jovi-native`)
  are never imported on web. Wrap them in `.native.js` files with `.web.js` stubs.

---

## 4. Android APK

### 4.1 Sign-in

- Google sign-in (`@react-native-google-signin/google-signin`, already installed) is **required
  before any AI call**. Tabs, the camera, notes and gallery browsing work signed out. Triggering an
  AI action signed out opens the sign-in prompt, then retries the action.
- Server flow: `POST /api/auth/google` → session token (prod spec §5.5, §5.7). Restore
  `services/googleAuth.js` from commit `c7de091`.
- Remove `expo-auth-session` and the `main`-era `useGoogleSignIn` hook once the native flow is
  restored.

### 4.2 The 3-interaction quota

- **3 credits per Google account, for life**, granted at first sign-in (prod spec §5.6, unchanged).
  Signing out and back in, reinstalling, or switching devices doesn't reset them.
- **1 interaction = 1 successful AI generation call.**

| Costs 1 | Free |
|---|---|
| Photo analysis and any photo action (explain, solve, quiz, flashcards, ask, extract) | Failed calls (refunded) |
| Estúdio: questions, exam, study plan, podcast script, lesson script | Idempotent retries |
| Video recommendation | Answer grading (D6): `subject-ai` action `grade` |
| | Any BYOK call (D7) |
| | On-device TTS/STT, sign-in, `/api/me`, `/api/byok/validate` |

Grading stays free but keeps its own burst bucket (prod spec §5.5) so it can't be abused as a free
general-purpose AI.

- Resetting a tester: `SET credits:<sub> 3` in the Upstash console (runbook).

### 4.3 No Play Integrity (D8)

Play Integrity is **not used**. Distribution is limited, and there's no time for the Google Cloud,
service-account and certificate setup (prod spec H1b, H2, H5).
- Server: `JOVI_REQUIRE_INTEGRITY` stays unset or `false`. Guard step 8 is already skipped then, so
  no backend code changes. `PLAY_INTEGRITY_*` vars aren't needed.
- App: don't restore `services/integrity.js`. Send no `x-play-integrity-token` and don't warm up a
  token provider. Remove `EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER` from `eas.json`.
- `modules/jovi-native` (integrity + calendar) is then unused, because the calendar is also out
  (D4). Delete it in M4, along with the `READ_CALENDAR` and `POST_NOTIFICATIONS` permissions and
  the `expo-notifications` plugin.
- Kept: release signing, `allowBackup=false`, HTTPS-only production builds.

**Accepted risk.** Without integrity, someone can extract the shared `x-api-key` from the APK and
call the API from a script. What still limits abuse: every AI call needs a Google sign-in, each
account has only 3 credits, new accounts are rate-limited per IP per day
(`JOVI_SIGNUP_LIMIT_PER_IP_DAY`), and burst limits apply per user. Rotating `JOVI_API_KEY` means
shipping a new APK.

### 4.4 Credit UI

- Profile → Copilot card slot: "*N* de 3 interações restantes". The value comes from `/api/me` on
  launch, when the app returns to the foreground, and from the `credits-remaining` response header
  after each call.
- At 0, every AI button stays visible. Pressing one shows an inline message in the same red alert
  style as `main`'s errors: "Você usou suas 3 interações gratuitas." The message has an "Adicionar
  minha chave" action that opens the BYOK form (§4.5).
- With a BYOK key saved, the card shows "Usando sua chave · <Provedor>" in place of the counter.

### 4.5 Bring your own key (D7, Android only)

Keep the BYOK design from prod spec §5.10 and §6.6 (commit `c7de091`), restyled into `main`'s look:
- Providers: Gemini, OpenAI, MiniMax. The key is validated through `POST /api/byok/validate`, stored
  in `expo-secure-store` (already installed), sent per request as `x-ai-provider` / `x-ai-key`, and
  never stored or logged server-side.
- A BYOK call costs no credits and is allowed with 0 credits left. Google sign-in is **still
  required**, because sessions and burst limits apply to every Android call.
- With a BYOK key whose provider supports it, TTS/STT use the server route with that key. Otherwise
  they use the on-device engines.
- UI: an expandable section inside the Copilot card. It holds a provider picker, the key field,
  "Validar e salvar", "Trocar chave" and "Remover chave", along with the pt-BR guidance copy from
  `c7de091`'s `AiAccessCard`. It uses only `main`'s existing card, input and button styles. Don't add
  a separate card.
- Web never shows BYOK (P1). The tester access makes it pointless there.

---

## 5. Environment variables

### 5.1 API project (Vercel, plus the root `.env` locally)

Everything in prod spec §3.1, plus:

| Var | Value | Notes |
|---|---|---|
| `JOVI_TESTER_KEY` | 64 hex chars | Signs tester cookies. Unset means tester access is off |
| `JOVI_TESTER_ACCESS_CODE` | 8–12 chars | Handed to testers. Changing it revokes every cookie |
| `JOVI_TESTER_DAILY_CAP` | `3000` | Global daily ceiling on tester calls (D2) |

### 5.2 Web build (env for `expo export --platform web`, set in Vercel build env)

| Var | Value |
|---|---|
| `APP_VARIANT` | `web` |
| `EXPO_PUBLIC_JOVI_LENS_DEMO_MODE` | `false` |
| `EXPO_PUBLIC_API_BASE_URL` | empty (same origin) |

**No** tester secret or access code is ever an `EXPO_PUBLIC_*` variable. `EXPO_PUBLIC_JOVI_API_KEY` is
also not set for web: tester calls are authorized by the cookie, so the guard's API-key step (4)
accepts a valid tester cookie in place of `x-api-key`.

### 5.3 Android (`eas.json` → `production`)

Current `eas.json` minus the Play Integrity project number (D8): demo off, API base URL, Google web
client ID, and `EXPO_PUBLIC_JOVI_API_KEY` as a sensitive EAS env var.

---

## 6. Backend changes

1. New `api/_lib/tester.js`: sign and verify the cookie, compute `codeVersion`, and do the
   constant-time code compare.
2. New route `POST /api/tester/unlock` (auth none, cost 0, byok forbidden, per-IP
   failure bucket). It sets the cookie (§3.2 step 4). `POST /api/tester/lock` clears it.
3. `api/_lib/guard.js`: step 4b (tester cookie), API-key step 4 satisfied by a valid tester cookie,
   the daily cap, and the `TESTER_CODE_INVALID` and `TESTER_CAP_REACHED` codes.
4. Server TTS/STT routes: when `ctx.tester`, use the server provider (the same path as the dev
   bypass).
5. `/api/me` for a tester returns `{ tester: true }` and no credit fields.
6. `vercel.json`: a build command that runs the Expo web export into `public/` (keeping
   `privacy.html`), and a SPA rewrite for non-`/api` paths.
7. Tests: unlock with the right code sets the cookie and a wrong code → 401, then 429 after 10. A
   valid cookie bypasses session and credits. A tampered or expired cookie, or one from
   before a code change, → normal path. Cap → 429. Code, cookie and key never appear in logs.

## 7. Client changes

1. `services/env.js`: add `isWebTester()` (`Platform.OS === 'web'` plus a tester key present).
2. `services/apiClient.js`: restore the `c7de091` version, which adds session, idempotency and
   BYOK headers and `code`-carrying errors, **without** the integrity token (D8). On web, send
   `credentials: 'same-origin'` so the tester cookie goes along, and skip the session header.
3. Restore `services/aiAccess.js` (credits **and** BYOK) and `services/apiErrors.js` from `c7de091`.
4. Web access screen (P5) plus `services/testerAccess.js`: read `?acesso=`, call unlock, strip the
   param, check `/api/me`. Map `SIGN_IN_REQUIRED` on web to the access screen.
5. `services/audio.js`: split TTS text at 2000 characters with `shared/textChunks.js`. The server
   rejects longer text.
6. Profile, Copilot card, BYOK section and error states: implement §2.3, §4.4 and §4.5 inside
   `main`'s existing components and styles.
7. `context/AppDataContext.jsx`: load no seed data in production (D5), the same as `c7de091`'s
   `DEMO ? sampleRecords : []`. Clearing data restores nothing in production.
8. Gate all demo-only UI on `isDemoMode()`. Production builds never show it.

---

## 8. Milestones

| # | Deliverable | Done when |
|---|---|---|
| M1 | Backend: tester unlock, cookie, guard bypass, daily cap, tests | `npm run check` passes. Tester calls work against local `server/local-api.js` |
| M2 | Expo web export renders every tab in Chrome with real AI, behind the access screen | Parity QA (§10) passes on web, locally |
| M3 | Android: Google sign-in, credits, credit UI, BYOK, real AI | Device QA passes on a fresh install |
| M4 | §2.3 cleanup: demo controls gated, Outlook card removed, no seed data, empty states | Side-by-side screenshots of web and Android show only the §2.2 differences |
| M5 | Web served from the API Vercel project, retire `web/`, update README/runbook | Testers open the access link and use the app. A code change has been shown to lock out an old cookie |

## 9. Decisions (2026-10-22)

| # | Question | Decision |
|---|---|---|
| D1 | How is the web URL protected? | **The tester key stays server-side.** Testers unlock with an access code/link, which sets a 12 h signed `HttpOnly` cookie (§3.2). Changing the code revokes access |
| D2 | Global daily cap on tester calls? | **Yes, 3000 calls per UTC day** |
| D3 | Server TTS/STT on web vs. on-device on Android? | **Accepted** |
| D4 | Fake Outlook calendar card | **Removed** from both production builds |
| D5 | Sample library in production | **Not kept.** Production builds start empty, with empty states |
| D6 | Does answer grading cost a credit? | **No, it's free** |
| D7 | BYOK on Android | **Kept** (§4.5) |
| D8 | Play Integrity | **Dropped.** Limited distribution, no time to set it up (§4.3) |

## 10. Parity QA (run on both builds, side by side)

1. Every tab (Hoje, Câmera, Galeria, Notas, Perfil) matches `main`'s layout, apart from P1–P5. A
   fresh install starts empty, with empty states, and there's no Outlook card.
2. Capture or import a photo → analyze → save a note → open the subject's Estúdio → generate
   questions, an exam, a plan, a podcast and a lesson → get a video recommendation.
3. Web: without the code, the access screen blocks the app. A wrong code 10 times gets rate limited.
   The access link unlocks it and `acesso` disappears from the URL. Run step 2 more than 3 times and
   nothing is blocked. Change the code on the server, and the next AI call goes back to the access
   screen.
4. Android: signed out, an AI action prompts sign-in, then runs. After 3 successful calls, the 4th
   shows "Você usou suas 3 interações gratuitas." Grading an answer doesn't change the counter.
   Reinstalling doesn't restore credits.
5. Android BYOK: add a valid Gemini key with 0 credits left. AI works and the counter is replaced
   by "Usando sua chave". An invalid key is rejected at "Validar e salvar". Remove the key and the
   app is back to 0 credits.
6. Force a network failure on both builds: the same error text and the same retry button appear.
7. The presentation APK still behaves exactly like `main`'s demo, including the sample library and
   the Outlook card.
