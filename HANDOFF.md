# JOVI Lens — production handoff

Everything an agent needs to continue the production release from branch `prod_app`. Read this first, then
`prod-web-android-spec.md` (the approved product spec, decisions D1–D9).

Status on 2026-10-22: **M1–M4 done and tested; M5 (deploy) not started.** The Android flow was verified end to end on a
real phone (moto g42) against the local API; the web flow was verified in headless Chromium against the local API.

---

## 1. What is being built

One Expo (React Native) codebase, shipped as two "identical" production apps with the same screens and features:

| | Web tester build | Android APK |
|---|---|---|
| Who | Many testers in a monitored environment | Testers who download the APK |
| Access | Shared access code → signed HttpOnly cookie (12 h) | Google sign-in |
| AI limit | Unlimited, global cap 3000 calls/day | 3 free interactions per Google account, or unlimited with the user's own key (BYOK) |
| Voice | Server TTS | Device TTS |
| Hosting | Static Expo web export, same Vercel project as the API | APK calls the Vercel API |

`main` is the **demo** app (Demo Mode on, sample data, fake login). `prod_app` is `main`'s UI with the real backend.
Demo Mode is a build flag (`EXPO_PUBLIC_JOVI_LENS_DEMO_MODE`); with it off, every demo-only control, sample photo, sample
note and pre-generated subject content is hidden.

## 2. Repo map (what matters for production)

| Path | What |
|---|---|
| `api/` | Vercel Functions. Every route goes through `api/_lib/guard.js` (`defineRoute`): CORS, API key or tester cookie, session, rate limits, idempotency, BYOK, credits |
| `api/_lib/tester.js`, `api/tester/{unlock,lock}.js` | Web tester access (D1) |
| `api/auth/google.js` | Exchanges a Google id_token (once) for a 30-day HMAC session |
| `api/_lib/ai/` | Provider adapters (`providers/minimax.js` is the server provider) and prompts |
| `api/_lib/store.js` | Upstash Redis (credits, rate limits, idempotency). In-memory only off Vercel; **on Vercel a missing store is an error** |
| `server/` | Local Node server that mounts the same handlers (`server/local-api.js`). `JOVI_WEB_DIST=dist` also serves the web export |
| `app/`, `components/`, `services/`, `context/` | The Expo app |
| `services/apiClient.js` | Single fetch path: API key (native only), session, Idempotency-Key, BYOK headers, credits header, sign-in on demand |
| `services/googleAuth.native.js` / `googleAuth.js` | Android Google sign-in / web stub |
| `services/aiAccess.js` | Credits + BYOK state, out-of-credits notice |
| `services/testerAccess.js`, `components/TesterGate.jsx` | Web access screen |
| `public/about.html`, `public/privacy.html`, `public/terms.html` | Pages for the Google consent screen (copied into `dist/` by the export) |
| `vercel.json` | `npm ci` → `npm run build:web` → serve `dist/`; SPA rewrite for everything except `/api/` |
| `web/` | **Old** Vite web client. To be retired in M5 (not used by the build) |
| `prod-web-android-spec.md` | The spec |

Metro picks platform files (`foo.native.js`) **only for extensionless imports**. `googleAuth` and `byokStore` are imported
without `.js` on purpose; adding the extension makes Android bundle the web stub.

## 3. Milestones

| # | Commit | What shipped |
|---|---|---|
| — | `30b8fd0` | App UI reset to `main`'s demo look, production backend kept |
| M1 | `60bed7f` | Tester unlock/lock routes, signed cookie, guard bypass, 3000/day cap, free answer grading (D6), Play Integrity optional and off (D8) |
| M2 | `9e01fac` | Expo web export behind the access screen; `vercel.json`; local server can serve `dist/` |
| M3 | `23864d7` | Android Google sign-in, credits UI, BYOK, out-of-credits dialog; device-test fixes (see §8); MiniMax model split |
| M4 | (this commit) | No seed data in production builds, empty state on Hoje, demo wording removed from errors, consent-screen pages |
| M5 | — | **Next.** See §6 |

## 4. Environment variables

Secrets live only in the root `.env` locally (gitignored, CRLF line endings — load it with `node --env-file=.env`, not
`source`) and in Vercel project settings in production. **Never** make the tester key or access code an
`EXPO_PUBLIC_*` variable: those are inlined into the client bundle.

### 4.1 Vercel (API + web build)

| Var | Value / notes |
|---|---|
| `AI_PROVIDER` | `minimax` (D9) |
| `MINIMAX_API_KEY` | Server AI key |
| `MINIMAX_CHAT_MODEL` | Optional. Default `MiniMax-Text-01` (text-only calls) |
| `MINIMAX_VISION_MODEL` | Optional. Default `MiniMax-M3` (calls with an image) |
| `GOOGLE_CLIENT_ID` | The **Web** OAuth client ID (below). It is the audience of the Android id_token |
| `JOVI_SESSION_SECRET` | Random, ≥ 32 chars. Signs app sessions |
| `JOVI_API_KEY` | Shared app key the APK sends as `x-api-key` (must equal the APK's `EXPO_PUBLIC_JOVI_API_KEY`) |
| `JOVI_REQUIRE_INTEGRITY` | `false` |
| `JOVI_TESTER_KEY` | Random, ≥ 32 chars (64 hex recommended). Unset = tester access off |
| `JOVI_TESTER_ACCESS_CODE` | 8–12 chars, given to testers. Changing it revokes every tester cookie |
| `JOVI_TESTER_DAILY_CAP` | `3000` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Required on Vercel (or the `KV_REST_API_*` names from the Vercel Upstash integration) |
| `JOVI_FREE_CREDITS` | Optional, default 3 |

The guard fails closed in production when `AI_PROVIDER`, `GOOGLE_CLIENT_ID`, `JOVI_SESSION_SECRET` or `JOVI_API_KEY`
is missing. The web build sets its own env in the `build:web` script (`APP_VARIANT=web`, demo off, empty
`EXPO_PUBLIC_API_BASE_URL` so it calls its own origin); nothing else is needed at build time.

### 4.2 Android build (`eas.json` → `production`, or the root `.env` for local builds)

| Var | Value |
|---|---|
| `EXPO_PUBLIC_JOVI_LENS_DEMO_MODE` | `false` |
| `EXPO_PUBLIC_API_BASE_URL` | `https://<vercel domain>` — **still a placeholder in `eas.json`** |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Web client ID (already in `eas.json`) |
| `EXPO_PUBLIC_JOVI_API_KEY` | Same value as the server's `JOVI_API_KEY` (set as an EAS sensitive env var, not in the file) |

## 5. Google Cloud / OAuth

Project number `301410724957`. Consent screen audience: **External, Testing** (only listed test users can sign in;
`arturbrandi5@gmail.com` and `smurfboris46@gmail.com` are test users).

| Client | ID |
|---|---|
| Web (server audience, `GOOGLE_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`) | `301410724957-kk4jv0aaub13btl1mpdu1h711t4sk0op.apps.googleusercontent.com` |
| Android (`com.jovilens.app`) | `301410724957-8kpp3mvqfr01elhhkg4450t5cmn7mhuh.apps.googleusercontent.com` |

The Android client is registered with SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`, which is
`android/app/debug.keystore` (what local release builds are signed with). **An EAS build is signed with a different key:
add that key's SHA-1 to the Android OAuth client (or create a second Android client), or Google sign-in fails with
`DEVELOPER_ERROR`.** Get it with `eas credentials`.

To publish the consent screen (Branding page), after the deploy:
- App home page: `https://<vercel domain>/about.html`
- Privacy policy: `https://<vercel domain>/privacy.html`
- Terms of service: `https://<vercel domain>/terms.html`
- Authorized domain: the Vercel domain

**Before publishing:** `public/privacy.html` and `public/terms.html` contain the placeholder `CONTACT_EMAIL`. The owner
must choose the public contact address; replace every occurrence, rebuild, redeploy.

## 6. M5 — deploy (next steps)

1. Fork the repo and import the fork into Vercel (framework: Other; `vercel.json` sets install/build/output and region
   `gru1`). Deploy branch `prod_app`.
2. Add an Upstash Redis store (Vercel Marketplace → Upstash) so the `KV_REST_API_*` or `UPSTASH_*` vars are injected.
3. Set every var in §4.1 for Production. Redeploy.
4. Smoke test:
   - `https://<domain>/about.html`, `/privacy.html`, `/terms.html` return the pages.
   - `https://<domain>/` shows "Acesso de teste"; a wrong code is refused; `/?acesso=<code>` unlocks and strips the code
     from the URL; all five tabs render; one AI action works.
   - Change `JOVI_TESTER_ACCESS_CODE`, redeploy, confirm the old cookie is locked out (spec M5 exit criterion).
5. Set `EXPO_PUBLIC_API_BASE_URL` to the Vercel URL in `eas.json` `production`, build the APK (`eas build -p android
   --profile production`, or locally — §7), add the signing SHA-1 (§5), install, and run the device checks (§9).
6. Fill the consent screen URLs (§5), replace `CONTACT_EMAIL`, publish the consent screen (or keep Testing and add each
   tester as a test user).
7. Retire `web/` (old Vite client) and update `README.md` / runbook to describe the two production builds.

## 7. Local development and builds

- Toolchain (WSL): Node 22 via nvm, JDK 17 at `~/tools/jdk-17.0.20.1+1`, Android SDK at `~/Android/Sdk`; `~/.bashrc`
  exports `JAVA_HOME`/`ANDROID_HOME`. No emulator (no KVM access).
- Checks: `npm run check` (eslint + `node --test`; 184 tests pass, 0 lint errors, 22 old warnings). Tests use
  `node:test`, **not** vitest.
- Web: `npm run build:web` → `dist/`; serve it with the API:
  `JOVI_API_PORT=8799 JOVI_WEB_DIST=$PWD/dist JOVI_TESTER_KEY=<32+ chars> JOVI_TESTER_ACCESS_CODE=<code> node --env-file=.env server/local-api.js`
- Android full build (~45 min, the repo is on `/mnt/d`):
  `APP_VARIANT=development CI=1 npx expo prebuild --platform android --clean --no-install`, restore
  `android/app/debug.keystore` (prebuild `--clean` deletes it; keep a copy), then
  `cd android && ./gradlew assembleRelease --no-daemon --max-workers=2`.
- Android JS-only rebuild (~7 min): skip prebuild, run only the gradle step. After changing an `EXPO_PUBLIC_*` value,
  delete `android/app/build/generated/assets/react/release` first or the old bundle is reused.
- `APP_VARIANT=development` allows cleartext HTTP (needed for `http://127.0.0.1:8787`); production does not.
- Phone testing: `scripts/phone-dev.sh <ip>:<pairPort> <code> --install <apk>` pairs over wireless adb, tunnels the
  phone's `127.0.0.1:8787` to this PC (`adb reverse`), and runs the local API. The APK must be built with
  `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8787`.
- The release bundle is Hermes bytecode: grep it only for ASCII strings
  (`unzip -p app-release.apk assets/index.android.bundle | grep -a -c <ascii>`).

## 8. Things learned the hard way

- **MMKV v4 has `remove()`, not `delete()`.** The old `storage.delete()` threw inside a `try/catch`, so "Sair" never
  removed the session (also broken on `main`). Fixed; `tests/storageApi.test.js` guards it.
- **A Google id_token can be exchanged only once.** Parallel `signIn()` calls now share one in-flight promise.
- **Nothing may prompt for sign-in at launch.** `refreshCredits()` returns early without a session; a saved user without a
  session is renewed silently or cleared (`restoreSession`).
- **`SmartImageSheet` accepted one question per photo** (`askingRef` never reset). Fixed (also broken on `main`).
- **MiniMax quality:** MiniMax-M3 and all M2.x models break about half of pt-BR text replies with English/Chinese tokens
  ("realizationava", "fábrica de九江"), at any temperature, with or without thinking. MiniMax-Text-01 gave 0/9 slips but is
  shallow on photos (and ~30 s for subject content, within the 45 s limit). Hence the split: text → Text-01, image →
  M3. M3 photo analyses looked clean in testing but were not measured at scale; watch for slips.
- `public/index.html` must not exist: the Expo export copies `public/` and it would replace the app's page.
- The web build must not send `x-api-key` (the local `EXPO_PUBLIC_JOVI_API_KEY` would leak into the bundle); web is
  authorized by the tester cookie.
- The WSL clock jumps: negative `ms` values in local logs are clock artifacts.

## 9. Verified behaviour (device test, 2026-10-22)

Android (release APK, local API, MiniMax):
- Launch opens no account picker; Perfil signed out shows "Entre para usar a IA" + "Entrar com Google".
- Google sign-in works for test users; Perfil shows name, email, "3 de 3 interações restantes".
- Each AI call decrements 3 → 2 → 1 → 0; the 4th is refused (402 `CREDITS_EXHAUSTED`) and shows the "Interações
  gratuitas esgotadas" dialog; "Adicionar minha chave" opens Perfil. Grading does not spend.
- BYOK: a wrong key is rejected with a message; a valid MiniMax key is saved ("Usando sua chave · MiniMax"), AI works at
  0 credits, "Remover chave" restores the counter.
- "Sair" survives an app restart; an AI action while signed out opens the account picker; cancelling shows "Entre com sua
  conta Google para usar a IA."
- A phone that ran a demo build loses the sample notes/photos/artifacts on first launch; Hoje, Notas and Galeria show
  empty states.

Web (production export, local server): access screen, wrong code refused, code and `?acesso=` link unlock, all tabs
render, real AI call through the tester cookie, empty states, consent pages served with status 200.

Not yet verified: anything on Vercel (build, Upstash, cookies over HTTPS with `Secure`), an EAS-signed APK, the
tester daily cap under real load.
