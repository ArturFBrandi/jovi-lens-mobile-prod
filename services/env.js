// RN/Metro has no `import.meta.env` (that's Vite-only); Expo's convention for
// client-readable env vars is `process.env.EXPO_PUBLIC_*`, inlined at build time.
// Mirrors the web app's `VITE_JOVI_LENS_DEMO_MODE` flag.
//
// Unset flag → demo (a presentation build must never depend on a backend).
// Explicit "false" with no API base URL also falls back to demo: there is no
// backend to reach, and failing every AI call with a config error is worse
// than showing clearly-labelled example content.
export function isDemoMode() {
  const flag = String(process.env.EXPO_PUBLIC_JOVI_LENS_DEMO_MODE ?? 'true').toLowerCase();
  return flag === 'true' || !process.env.EXPO_PUBLIC_API_BASE_URL;
}
