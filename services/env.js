// RN/Metro has no `import.meta.env` (that's Vite-only); Expo's convention for
// client-readable env vars is `process.env.EXPO_PUBLIC_*`, inlined at build time.
//
// The only demo switch: true only in the presentation build (eas.json), which
// is fully offline with sample data. Production web and Android builds set it
// to false (prod-web-android-spec.md §5). The web build has no API base URL —
// it calls its own origin — so a missing URL no longer implies demo.
export function isDemoMode() {
  return String(process.env.EXPO_PUBLIC_JOVI_LENS_DEMO_MODE ?? 'false').toLowerCase() === 'true';
}
