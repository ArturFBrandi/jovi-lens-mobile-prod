import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactNativeA11y from 'eslint-plugin-react-native-a11y';

// One flat config for the whole repo: the React Native app at the root, the Vite
// web app in web/, the shared logic in shared/, and the Node backend in api/ +
// server/. Each gets only the rules that make sense for it — accessibility is the
// clearest example, since the two clients need different plugins for it:
// jsx-a11y reasons about DOM elements (<button>, <img alt>) and is blind to
// <Pressable>/<View>, which is what react-native-a11y checks instead.
//
// Deliberately NOT using @react-native/eslint-config: it is the official preset
// but pulls prettier, ft-flow and jest rules this project does not use.

const reactSettings = { react: { version: 'detect' } };

// Shared across both clients. prop-types is off on purpose: this is plain JS with
// no runtime type checking anywhere, and turning it on would flag every component
// in the repo without catching a single real defect.
const reactRules = {
  ...react.configs.flat.recommended.rules,
  ...reactHooks.configs['recommended-latest'].rules,
  'react/prop-types': 'off',
  'react/react-in-jsx-scope': 'off', // React 19 + automatic JSX runtime

  // The two rules below are WARNINGS on purpose, and the reason is not "too noisy".
  // Each fires on more than one distinct pattern — the notes below cover every
  // trigger `npm run lint` currently reports for each rule, not just the first one.
  //
  // set-state-in-effect (6 reports, 3 files) has two distinct triggers, both the
  // same underlying anti-pattern: NoteEditor.jsx and SmartImageSheet.jsx reset
  // local state from an effect when the record/note prop changes — SmartImageSheet
  // does this twice, once resetting the whole view (record?.id/initialView) and
  // again resetting just the analysis-loading guard (analysisRequestedFor).
  // React's own answer is to remount via a `key` instead — but that means touching
  // 11 mount sites across both clients and remounting a component that holds 18
  // hooks and an in-flight AbortController, and which has never run on a device.
  // Commit fe30332 ("stop runaway re-analysis loop") is what happens when this area
  // is changed without a device to verify on. Left visible, not silenced.
  //
  // immutability (4 reports, 2 files) has two UNRELATED triggers, not one:
  // (1) `beginNarration` referenced inside a closure before its own `function
  // beginNarration() {}` declaration later in the same component, in both
  // components/LessonPlayer.jsx and web/components/LessonPlayer.jsx — a
  // forward-reference the rule flags defensively. Not a runtime bug (function
  // declarations hoist), just a false-positive shape from the rule.
  'react-hooks/set-state-in-effect': 'warn',
  'react-hooks/immutability': 'warn',
};

const commonRules = {
  ...js.configs.recommended.rules,
  // An empty catch is the established way this codebase ignores a failed
  // storage/clipboard write without breaking the screen (see services/storage.js).
  'no-empty': ['error', { allowEmptyCatch: true }],
  // ignoreRestSiblings covers the deliberate `const { image, ...rest } = entry`
  // idiom used to strip a field — the binding is unused precisely because that is
  // the point (see context/AppDataContext.jsx, which drops heavy base64 images
  // before persisting history).
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
};

// `all` minus has-accessibility-hint. A hint is meant for an action whose result
// is not obvious from its label; requiring one on every labelled control would add
// ~90 redundant strings and train us to ignore the rule. The rest stays at error —
// accessibility is not a warning-level concern.
const rnA11yRules = Object.fromEntries(
  Object.entries(reactNativeA11y.configs.all.rules).filter(([rule]) => rule !== 'react-native-a11y/has-accessibility-hint'),
);

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'web/dist/**', '.expo/**', 'android/**', 'ios/**', '.playwright-mcp/**'],
  },

  // React Native app (repo root).
  {
    files: ['app/**/*.{js,jsx}', 'components/**/*.{js,jsx}', 'hooks/**/*.{js,jsx}', 'context/**/*.{js,jsx}', 'services/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.es2024,
        __DEV__: 'readonly', // injected by Metro
        require: 'readonly', // Metro's static asset require (services/demoAssets.js)
        process: 'readonly', // Metro inlines process.env.EXPO_PUBLIC_* at build time
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        structuredClone: 'readonly',
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: reactSettings,
    plugins: { react, 'react-hooks': reactHooks, 'react-native-a11y': reactNativeA11y },
    rules: { ...commonRules, ...reactRules, ...rnA11yRules },
  },

  // Web app (DOM).
  {
    files: ['web/**/*.{js,jsx}'],
    ignores: ['web/tests/**', 'web/scripts/**'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2024 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: reactSettings,
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: { ...commonRules, ...reactRules, ...jsxA11y.flatConfigs.recommended.rules },
  },

  // Shared logic: runs inside both clients, so React hook rules apply, but it must
  // stay free of anything platform-specific — no browser and no RN globals here.
  {
    files: ['shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      // console/fetch/AbortController are universal (Node, browser, and Hermes/RN
      // all have them), unlike __DEV__/require/process which are Metro-only or
      // window/document which are DOM-only — safe to include here even though
      // nothing in shared/ uses them yet, so the first one added doesn't turn
      // into a hard no-undef error.
      globals: { ...globals.es2024, setTimeout: 'readonly', clearTimeout: 'readonly', structuredClone: 'readonly', console: 'readonly', fetch: 'readonly', AbortController: 'readonly' },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...commonRules, ...reactHooks.configs['recommended-latest'].rules },
  },

  // Backend + local server + tests: plain Node ESM.
  {
    // This file itself is included: without it, `eslint --print-config
    // eslint.config.js` returns zero rules — parsed (a syntax error would still
    // be caught), but nothing in it is actually checked.
    files: ['api/**/*.js', 'server/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'web/tests/**/*.js', 'web/scripts/**/*.js', 'eslint.config.js', 'app.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2024 },
    },
    rules: commonRules,
  },

  // Tooling configs kept in CommonJS so Babel/Metro/Tailwind can load them.
  {
    files: ['*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.commonjs },
    },
    rules: commonRules,
  },
];
