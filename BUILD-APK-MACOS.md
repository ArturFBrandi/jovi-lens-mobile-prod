# Building the JOVI Lens Android APK on macOS

This guide takes a Mac from nothing installed to a signed release APK of JOVI Lens, ready to sideload or attach to a
GitHub release. It covers the **production** build: real AI, Google sign-in, and the live backend at
`https://jovi-lens-mobile-prod.vercel.app`. The demo and development variants are covered in §9.

Every command is meant for the macOS **Terminal** (zsh, the default shell) and works on Apple Silicon and Intel Macs.

> **Expo Go does not work for this app.** It uses native modules that Expo Go doesn't include, among them
> `react-native-vision-camera`, `react-native-mmkv`, `@react-native-google-signin/google-signin` and the local
> `modules/jovi-native`. You must compile an APK.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Install the toolchain](#2-install-the-toolchain)
3. [Get the code and the secrets](#3-get-the-code-and-the-secrets)
4. [The signing key (read this before building)](#4-the-signing-key-read-this-before-building)
5. [Build the production APK](#5-build-the-production-apk)
6. [Verify the APK before you ship it](#6-verify-the-apk-before-you-ship-it)
7. [Install it on a phone](#7-install-it-on-a-phone)
8. [Publish a GitHub release](#8-publish-a-github-release)
9. [Other variants and faster rebuilds](#9-other-variants-and-faster-rebuilds)
10. [Troubleshooting](#10-troubleshooting)
11. [Quick reference](#11-quick-reference)

---

## 1. What you need

| Tool | Version | Why this exact version |
| --- | --- | --- |
| macOS | 13 Ventura or newer | Needed by current Android Studio and the JDK |
| Xcode Command Line Tools | latest | git, clang, make |
| Homebrew | latest | Installs everything else |
| Node.js | **22.x** | Expo SDK 57 needs Node 20.19+; the project is tested on 22 |
| JDK | **17** | The Gradle setup in this project does not support JDK 21+ |
| Android SDK Platform | **36** | `compileSdk`/`targetSdk`, from React Native 0.86 |
| Android Build-Tools | **36.0.0** | Same |
| Android NDK | **27.1.12297006** | Required, because several modules compile C++ |
| CMake | **3.22.1** | Same |

Disk: allow about **15 GB** (SDK + NDK ≈ 8 GB, `node_modules` ≈ 1.5 GB, Gradle caches and build output ≈ 5 GB).
RAM: 8 GB works; 16 GB or more is comfortable.

Main stack versions: Expo `~57.0.22`, React Native `0.86.3`, Gradle 9.3.1 (downloaded by the wrapper), Hermes and the
New Architecture both enabled.

---

## 2. Install the toolchain

### 2.1 Command Line Tools and Homebrew

```bash
xcode-select --install          # opens a dialog; skip if already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

On Apple Silicon, Homebrew lives in `/opt/homebrew`. Follow the two `echo … >> ~/.zprofile` lines it prints at the end,
then open a new Terminal window and check:

```bash
brew --version
```

### 2.2 Node 22

Use nvm so the version stays pinned:

```bash
brew install nvm
mkdir -p ~/.nvm
cat >> ~/.zshrc <<'EOF'
export NVM_DIR="$HOME/.nvm"
[ -s "$(brew --prefix nvm)/nvm.sh" ] && . "$(brew --prefix nvm)/nvm.sh"
EOF
source ~/.zshrc
nvm install 22
nvm alias default 22
node -v        # v22.x
```

### 2.3 JDK 17

```bash
brew install --cask zulu@17     # Azul Zulu 17, native on Apple Silicon and Intel
/usr/libexec/java_home -V       # lists installed JDKs; 17 must be there
```

> If several JDKs are installed, Gradle uses whatever `JAVA_HOME` points to. Setting `JAVA_HOME` (§2.5) pins JDK 17, so
> a newer JDK can stay installed.

### 2.4 Android SDK, NDK and CMake

Choose **one** of these options.

**Option A: Android Studio (recommended if you're new to Android).**

```bash
brew install --cask android-studio
```

1. Open Android Studio and finish the setup wizard (Standard install). It downloads an SDK to
   `~/Library/Android/sdk`.
2. Open **Settings → Languages & Frameworks → Android SDK** (on the welcome screen: **More Actions → SDK Manager**).
3. On **SDK Platforms**, tick **Android 16.0 ("Baklava") — API 36**.
4. On **SDK Tools**, tick **Show Package Details** (bottom right), then select:
   - **Android SDK Build-Tools → 36.0.0**
   - **NDK (Side by side) → 27.1.12297006**
   - **CMake → 3.22.1**
   - **Android SDK Platform-Tools**
   - **Android SDK Command-line Tools (latest)**
5. Click **Apply** and accept the licenses.

**Option B: command-line only (no Android Studio).**

```bash
mkdir -p ~/Library/Android/sdk/cmdline-tools && cd ~/Library/Android/sdk/cmdline-tools
curl -sSL -o cmdline.zip https://dl.google.com/android/repository/commandlinetools-mac-13114758_latest.zip
unzip -q cmdline.zip && mv cmdline-tools latest && rm cmdline.zip
cd ~
```

Set the environment (§2.5) first, then install the packages:

```bash
yes | sdkmanager --licenses > /dev/null
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
           "ndk;27.1.12297006" "cmake;3.22.1"
```

### 2.5 Environment variables

Add these lines to `~/.zshrc`, then run `source ~/.zshrc` or open a new window:

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/build-tools/36.0.0:$PATH"
```

### 2.6 Check the setup

Every line below must succeed before you continue:

```bash
node -v                                    # v22.x
java -version 2>&1 | head -1               # ... version "17.x"
echo $ANDROID_HOME                         # /Users/<you>/Library/Android/sdk
adb version                                # Android Debug Bridge ...
ls $ANDROID_HOME/ndk                       # 27.1.12297006
ls $ANDROID_HOME/build-tools               # 36.0.0
ls $ANDROID_HOME/platforms                 # android-36
ls $ANDROID_HOME/cmake                     # 3.22.1
```

Optional but useful:

```bash
brew install watchman gh       # watchman: faster Metro file watching; gh: GitHub CLI for releases (§8)
```

---

## 3. Get the code and the secrets

```bash
mkdir -p ~/dev && cd ~/dev
git clone -b prod_app https://github.com/ArturFBrandi/jovi-lens-mobile-prod.git
cd jovi-lens-mobile-prod
npm install
```

> All production work is on the **`prod_app`** branch, not `main`.

### 3.1 The `.env` file

`.env` is **not** in git (it's in `.gitignore`). Copy it from the machine that has it, through a private channel (an
encrypted note, a USB drive, AirDrop). Never paste it into a chat, an issue or a commit. Put it at the repository root.

For the **APK build**, only one value in `.env` matters:

| Variable | What it is |
| --- | --- |
| `EXPO_PUBLIC_JOVI_API_KEY` | The app key the APK sends as `x-api-key`. It **must equal** `JOVI_API_KEY` in the Vercel project, or every request fails with 401. |

Everything else in `.env` (MiniMax key, session secret and so on) is for running the backend locally. The production
backend reads its own copies from Vercel.

If you don't have the `.env`, you can still get the key from Vercel, if you have access to the project:

```bash
npx vercel link                       # choose the jovi-lens-mobile-prod project
npx vercel env pull .env.vercel       # writes JOVI_API_KEY and the other vars
```

Then put `EXPO_PUBLIC_JOVI_API_KEY=<value of JOVI_API_KEY>` in `.env`, and delete `.env.vercel` once you're done.

> The `.env` file also contains `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8787`, which is meant for local development.
> **Don't edit it for a production build.** The build command in §5 overrides it from the shell, and shell variables
> take precedence over `.env`.

---

## 4. The signing key (read this before building)

Google sign-in on Android only works when the APK is signed with a key whose **SHA-1 is registered** in the Google
Cloud OAuth client for `com.jovilens.app`. The one registered today is:

```
SHA-1: 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

This is the **React Native template debug keystore**. Every release so far is signed with it, and it lives at
`android/app/debug.keystore` (store password `android`, alias `androiddebugkey`, key password `android`).

What this means for you:

- **Sign with that same file.** If you sign with a different key, the app installs and opens, but the Google login
  fails with `DEVELOPER_ERROR`.
- **Phones keep app data across updates only when the signing key matches.** With a different key, Android refuses
  the update and testers must uninstall first.
- `android/` is gitignored, and `expo prebuild --clean` regenerates it, so **keep a copy of the keystore outside the
  repo**:

  ```bash
  mkdir -p ~/keys/jovi-lens
  # after the first prebuild (§5.2), or copied from the other machine:
  cp android/app/debug.keystore ~/keys/jovi-lens/debug.keystore
  ```

Check any keystore with:

```bash
keytool -list -v -keystore ~/keys/jovi-lens/debug.keystore -storepass android -alias androiddebugkey | grep SHA1
# must print: SHA1: 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

If the SHA-1 doesn't match, take the file from the other build machine (`android/app/debug.keystore`). This key is
public, the same file in every React Native template, so sending it is harmless.

> ⚠️ Because this key is public, anyone can sign an APK that Google accepts as JOVI Lens. That's fine for testers.
> **Before a wider or Play Store release**, create a real release keystore, register its SHA-1 in the Google Cloud
> console (project `301410724957` → Credentials → the Android OAuth client), and sign with it. Back it up offline:
> losing it means users must uninstall to update.

---

## 5. Build the production APK

### 5.1 Bump the version

Android refuses to install an "update" whose `versionCode` isn't higher than the installed one. In `app.json`, update:

```jsonc
"version": "1.1.0",          // expo.version: shown to users (versionName)
"android": {
  "versionCode": 5            // expo.android.versionCode: integer, +1 on every release
}
```

Release history: v1.0.0–v1.0.4 used versionCode 1–4, and v1.1.0 uses 5. The next release needs **6**.

Commit only `app.json` for the bump (`android/` is not tracked):

```bash
git add app.json && git commit -m "chore: release v1.1.1 (versionCode 6)"
```

### 5.2 Set the production variables and generate the native project

Run everything from the repository root, **in the same Terminal window**. The exports only last for that window.

```bash
export APP_VARIANT=production
export EXPO_PUBLIC_JOVI_LENS_DEMO_MODE=false
export EXPO_PUBLIC_API_BASE_URL=https://jovi-lens-mobile-prod.vercel.app
export EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=301410724957-kk4jv0aaub13btl1mpdu1h711t4sk0op.apps.googleusercontent.com
export NODE_ENV=production
# EXPO_PUBLIC_JOVI_API_KEY is read from .env (§3.1)
```

What each one does:

| Variable | Effect |
| --- | --- |
| `APP_VARIANT=production` | `app.config.js` sets package `com.jovilens.app`, and turns **off** cleartext HTTP (HTTPS only) |
| `EXPO_PUBLIC_JOVI_LENS_DEMO_MODE=false` | Real AI, no sample data. `true` builds the offline demo instead. |
| `EXPO_PUBLIC_API_BASE_URL` | Backend URL, **compiled into the APK**. It must be `https://`, or the app refuses to start. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | The **Web** OAuth client ID (the server audience), not the Android one |

All `EXPO_PUBLIC_*` values are baked into the JavaScript bundle at build time. Changing one later requires a rebuild.

Generate `android/`. This is needed the first time, and whenever native config changes: `app.json`, `app.config.js`,
plugins, or native dependencies.

```bash
npx expo prebuild --platform android --clean
cp ~/keys/jovi-lens/debug.keystore android/app/debug.keystore   # restore the signing key (§4)
```

If you don't have a saved keystore yet, check the one prebuild generated (§4). If its SHA-1 matches, save a copy now.

### 5.3 Compile

```bash
cd android
./gradlew assembleRelease
cd ..
```

- The first build downloads Gradle and the Maven dependencies, so it is slow: expect **15–30 minutes**. Later full
  builds take a few minutes, and a JS-only change rebuilds even faster (§9.2).
- If the build is killed for memory on an 8 GB Mac, add `--no-daemon --max-workers=2`.
- The output is a **universal APK** (all four ABIs, about 150 MB). That's what the GitHub releases ship. For an
  arm64-only APK (about 3× smaller; works on every modern phone but not on 32-bit or x86 devices), add
  `-PreactNativeArchitectures=arm64-v8a`.

The result is at:

```
android/app/build/outputs/apk/release/app-release.apk
```

---

## 6. Verify the APK before you ship it

A build can succeed and still be wrong: a stale bundle, the wrong URL, or the wrong key. The checks below take a minute
and catch all of these.

```bash
APK=android/app/build/outputs/apk/release/app-release.apk

# 1. Signed with the registered key?
apksigner verify --print-certs "$APK" | grep -i 'SHA-1'
#    → 5e8f16062ea3cd2c4a0d547876baa6f38cabf625

# 2. Right version, package, and HTTPS-only?
aapt2 dump badging "$APK" | head -1
#    → package: name='com.jovilens.app' versionCode='5' versionName='1.1.0' ...
aapt2 dump xmltree "$APK" --file AndroidManifest.xml | grep -iE 'usesCleartextTraffic|allowBackup'
#    → both must be false (0x0)

# 3. Points at production, not localhost?
unzip -p "$APK" assets/index.android.bundle | grep -a -c 'jovi-lens-mobile-prod.vercel.app'   # ≥ 1
unzip -p "$APK" assets/index.android.bundle | grep -a -c '127.0.0.1:8787'                      # 0

# 4. Checksum for the release notes
shasum -a 256 "$APK"
```

> The bundle is **Hermes bytecode**, not JavaScript text, so `grep` only finds string literals. Use ASCII-only search
> strings: text with accents (`Período`) is stored as UTF-16 and won't match.

---

## 7. Install it on a phone

### 7.1 USB (simplest on a Mac)

1. On the phone, open **Settings → About phone** and tap **Build number** 7 times. Then open **Settings → System →
   Developer options** and turn on **USB debugging**.
2. Connect the cable, and accept the "Allow USB debugging?" prompt on the phone.
3. Install:

```bash
adb devices                       # the phone must show as "device", not "unauthorized"
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

`-r` keeps the app's data. That only works when the installed app has the same signing key and a lower versionCode.

> **Coming from v1.0.4 or older (demo builds)?** The data isn't migrated. Uninstall first:
> `adb uninstall com.jovilens.app`.

### 7.2 Wireless debugging

The Mac and the phone must be on the same Wi-Fi network. On the phone, open **Developer options → Wireless debugging
→ Pair device with pairing code**.

```bash
adb pair <phone-ip>:<pairing-port> <6-digit-code>
adb connect <phone-ip>:<connect-port>     # a different port, shown on the Wireless debugging screen
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

On macOS, mDNS discovery works, so `adb devices` usually sees the phone right after pairing. `adb mdns services` lists
it if not.

### 7.3 Without adb

Send the APK to the phone (Google Drive, a GitHub release link, or `python3 -m http.server 8000` in the APK folder,
then open `http://<mac-ip>:8000/app-release.apk` in the phone's Chrome). Open the file and allow **Install unknown
apps** for the browser.

### 7.4 Smoke test on the device

1. Open the app. The **Hoje** screen shows "Seu plano começa com uma foto", with no sample data.
2. Sign in with Google. The profile shows **3 free interactions**.
3. Take or import a photo of notes, and analyze it. The answer is in Portuguese, and the credits go down by one.
4. Save it, open **Notas → the subject → Estúdio → Gerar perguntas**. The questions appear.
5. After the 3rd interaction, the "Interações gratuitas esgotadas" dialog appears.
6. **Perfil → Sair** signs out, and stays signed out after the app restarts.

To read JS errors from the device:

```bash
adb logcat -c && adb logcat | grep -E "ReactNativeJS|FATAL EXCEPTION"
```

---

## 8. Publish a GitHub release

```bash
gh auth login                                             # once
cp android/app/build/outputs/apk/release/app-release.apk jovi-lens-v1.1.1.apk
git tag v1.1.1 && git push origin prod_app v1.1.1
gh release create v1.1.1 jovi-lens-v1.1.1.apk \
  -R ArturFBrandi/jovi-lens-mobile-prod \
  --title "JOVI Lens v1.1.1 (Android)" \
  --notes-file release-notes.md
rm jovi-lens-v1.1.1.apk
```

Release notes convention (see release `v1.1.0` for the template):

- **Build:** versionName/versionCode, package, ABIs, source commit, SHA-256.
- **What changed:** build it from `git log v1.1.0..HEAD --oneline`.
- **Requirements**, the **testing-build warning** about the debug keystore, and an **Install** snippet.

---

## 9. Other variants and faster rebuilds

### 9.1 Variants

| Variant | `APP_VARIANT` | Package | Demo mode | Backend | Use |
| --- | --- | --- | --- | --- | --- |
| production | `production` | `com.jovilens.app` | `false` | Vercel (HTTPS) | Tester APK, GitHub releases |
| presentation | `presentation` | `com.jovilens.app.demo` | `true` | none (offline, canned answers) | Demos without internet; installs **alongside** production |
| development | `development` | `com.jovilens.app` | `false` | local API at `http://127.0.0.1:8787` | Working on the app with a local backend |

For **presentation**: `export APP_VARIANT=presentation EXPO_PUBLIC_JOVI_LENS_DEMO_MODE=true`, then do the same
prebuild and Gradle steps. It needs no API key or URL.

For **development** (local backend): run the API with `node --env-file=.env server/local-api.js`, build with
`APP_VARIANT=development` and the default `.env` URL, then tunnel the phone to your Mac with
`adb reverse tcp:8787 tcp:8787`. `scripts/phone-dev.sh` does the pairing, the tunnel and the server in one command, and
works on macOS. See `ANDROID_BUILD.md` §5. For live reload during development, use `npx expo run:android`.

### 9.2 JS-only rebuild (much faster)

If you only changed JavaScript (screens, services, `shared/`), **don't run prebuild again**. Rerun Gradle only, in a
window where the §5.2 exports are set:

```bash
rm -rf android/app/build/generated/assets/react/release android/app/build/generated/res/react/release
cd android && ./gradlew assembleRelease && cd ..
```

The `rm` matters. **Gradle doesn't track `.env` or `EXPO_PUBLIC_*` changes**, so without it the build can reuse the
old JS bundle. Then the APK silently keeps the old URL or the old demo flag.

Run prebuild again (§5.2) when you change `app.json`, `app.config.js`, config plugins, or add or upgrade a package
that has native code, then restore the keystore.

### 9.3 EAS cloud build (alternative)

`eas build -p android --profile production` builds in the cloud, using the variables from `eas.json`. EAS signs with
**its own** keystore, so add that SHA-1 (shown by `eas credentials -p android`) to the Android OAuth client first, or
Google login fails. It also sets `EXPO_PUBLIC_JOVI_API_KEY` as an EAS environment variable (sensitive). Testers who
have a locally signed build must uninstall before installing an EAS one.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Unsupported class file major version 65` / Gradle fails right away | Gradle is running with JDK 21+ | `export JAVA_HOME="$(/usr/libexec/java_home -v 17)"`, and check `java -version` |
| `SDK location not found` | `ANDROID_HOME` not set in this window | Run `source ~/.zshrc`, or create `android/local.properties` with `sdk.dir=/Users/<you>/Library/Android/sdk` |
| `NDK not configured` / `[CXX1101] NDK at … did not have a source.properties` | Wrong or partial NDK | `sdkmanager "ndk;27.1.12297006"`; delete a broken folder under `$ANDROID_HOME/ndk/` and reinstall |
| `bad CPU type in executable` (Apple Silicon) | An x86-only tool binary | `softwareupdate --install-rosetta --agree-to-license` |
| `EMFILE: too many open files` in Metro | macOS file-watch limit | `brew install watchman` |
| Gradle killed / `Daemon disappeared` | Out of memory | `./gradlew assembleRelease --no-daemon --max-workers=2`; close other apps |
| App closes right after opening | `EXPO_PUBLIC_API_BASE_URL` missing or not `https://` in a non-development build | Export the §5.2 variables, delete the generated bundle (§9.2), rebuild |
| Google login: `DEVELOPER_ERROR` | APK signed with a key whose SHA-1 isn't registered | Sign with the `5E:8F…F6:25` keystore (§4), or register the new SHA-1 |
| Every request: 401 / "chave do app" | `EXPO_PUBLIC_JOVI_API_KEY` ≠ Vercel `JOVI_API_KEY` | Fix `.env`, delete the generated bundle, rebuild |
| `CLEARTEXT communication not permitted` | An HTTPS-only build is pointed at an `http://` URL | Use the Vercel URL, or build `APP_VARIANT=development` for local work |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | The installed app was signed with another key | `adb uninstall com.jovilens.app`, then install (this erases app data) |
| `INSTALL_FAILED_VERSION_DOWNGRADE` | versionCode isn't higher than the installed one | Bump `versionCode` in `app.json`, prebuild, rebuild |
| APK still has the old URL, flag or text | Stale bundle reused by Gradle | Delete `android/app/build/generated/{assets,res}/react/release`, rebuild |
| `adb devices` shows `unauthorized` | Prompt not accepted on the phone | Unlock the phone, accept, or revoke authorizations in Developer options and reconnect |

Logs from a failed build: `./gradlew assembleRelease --stacktrace`, and look for the first `FAILURE:` block.

---

## 11. Quick reference

Once the toolchain is installed, a full production release looks like this:

```bash
cd ~/dev/jovi-lens-mobile-prod
git pull && npm install
# bump expo.version and expo.android.versionCode in app.json, commit

export APP_VARIANT=production EXPO_PUBLIC_JOVI_LENS_DEMO_MODE=false NODE_ENV=production \
  EXPO_PUBLIC_API_BASE_URL=https://jovi-lens-mobile-prod.vercel.app \
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=301410724957-kk4jv0aaub13btl1mpdu1h711t4sk0op.apps.googleusercontent.com

npx expo prebuild --platform android --clean
cp ~/keys/jovi-lens/debug.keystore android/app/debug.keystore
(cd android && ./gradlew assembleRelease)

APK=android/app/build/outputs/apk/release/app-release.apk
apksigner verify --print-certs "$APK" | grep -i sha-1          # 5e8f…f625
unzip -p "$APK" assets/index.android.bundle | grep -a -c jovi-lens-mobile-prod.vercel.app
shasum -a 256 "$APK"
adb install -r "$APK"
```

Related docs: `HANDOFF.md` (whole-project guide: backend, Vercel, OAuth, lessons learned), `ANDROID_BUILD.md`
(Portuguese build guide written for WSL, plus device debugging), `eas.json` (variant variables).
