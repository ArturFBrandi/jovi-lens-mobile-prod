# Building the JOVI Lens Android APK on Windows

This guide takes a Windows 10/11 PC from nothing installed to a signed release APK of JOVI Lens, ready to sideload or
attach to a GitHub release. It covers the **production** build: real AI, Google sign-in, and the live backend at
`https://jovi-lens-mobile-prod.vercel.app`. The demo and development variants are covered in §9.

It uses **native Windows** with **PowerShell**. Building in WSL also works, but it's a different setup, and much
slower when the repository is on a Windows drive. See §12.

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
12. [Building in WSL instead](#12-building-in-wsl-instead)

---

## 1. What you need

| Tool | Version | Why this exact version |
| --- | --- | --- |
| Windows | 10 (22H2) or 11, 64-bit | `winget` is built in |
| Git for Windows | latest | Also provides Git Bash, used by `scripts/phone-dev.sh` |
| Node.js | **22.x** | Expo SDK 57 needs Node 20.19+; the project is tested on 22 |
| JDK | **17** | The Gradle setup in this project does not support JDK 21+ |
| Android SDK Platform | **36** | `compileSdk`/`targetSdk`, from React Native 0.86 |
| Android Build-Tools | **36.0.0** | Same |
| Android NDK | **27.1.12297006** | Required, because several modules compile C++ |
| CMake | **3.22.1** | Same |

Disk: allow about **15 GB** (SDK + NDK ≈ 8 GB, `node_modules` ≈ 1.5 GB, Gradle caches and build output ≈ 5 GB), on
an SSD if possible. RAM: 8 GB works; 16 GB or more is comfortable.

Main stack versions: Expo `~57.0.22`, React Native `0.86.3`, Gradle 9.3.1 (downloaded by the wrapper), Hermes and the
New Architecture both enabled.

> **Use a short folder path.** The C++ build creates very deep paths, and Windows' 260-character limit breaks it with
> errors like `Filename longer than 260 characters`. Clone into **`C:\dev\jovi`**, not into `Documents\...` or
> `OneDrive\...`, and enable long paths (§2.1). Also keep the project **out of OneDrive**: syncing locks files in the
> middle of a build.

---

## 2. Install the toolchain

Open **PowerShell** (Start → type "PowerShell"). Steps marked **(Admin)** need **Run as administrator**; all others
run in a normal window.

### 2.1 Long paths and Git (Admin)

```powershell
# Allow paths longer than 260 characters
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force

winget install --id Git.Git -e
git config --system core.longpaths true
```

Close the window and open a new, normal (non-admin) PowerShell for the remaining steps.

### 2.2 Node 22

Use nvm-windows so the version stays pinned:

```powershell
winget install --id CoreyButler.NVMforWindows -e
```

Open a **new** PowerShell window, then:

```powershell
nvm install 22
nvm use 22          # may ask for admin approval (it creates a symlink)
node -v             # v22.x
```

> If you'd rather not use nvm: `winget install --id OpenJS.NodeJS.LTS -e` installs the current LTS. Check that
> `node -v` prints **v22**; if not, use nvm.

### 2.3 JDK 17

```powershell
winget install --id Azul.Zulu.17.JDK -e
```

The installer usually sets `JAVA_HOME`. You'll set it explicitly in §2.5 anyway, so a newer JDK can stay installed.

### 2.4 Android SDK, NDK and CMake

```powershell
winget install --id Google.AndroidStudio -e
```

1. Open **Android Studio** and finish the setup wizard (Standard install). It downloads an SDK to
   `%LOCALAPPDATA%\Android\Sdk`.
2. Open **Settings → Languages & Frameworks → Android SDK** (on the welcome screen: **More Actions → SDK Manager**).
3. On **SDK Platforms**, tick **Android 16.0 ("Baklava") — API 36**.
4. On **SDK Tools**, tick **Show Package Details** (bottom right), then select:
   - **Android SDK Build-Tools → 36.0.0**
   - **NDK (Side by side) → 27.1.12297006**
   - **CMake → 3.22.1**
   - **Android SDK Platform-Tools**
   - **Android SDK Command-line Tools (latest)**
   - **Google USB Driver** (only needed for Pixel phones; see §7.1)
5. Click **Apply** and accept the licenses.

> Command-line-only alternative: download `commandlinetools-win-*_latest.zip` from
> https://developer.android.com/studio#command-tools, extract it to `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`,
> set the variables (§2.5), then run:
> `sdkmanager --licenses` and
> `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"`.

### 2.5 Environment variables

These lines set the variables **permanently for your user**. Run them once:

```powershell
$jdk = (Get-ChildItem "C:\Program Files\Zulu" -Directory | Where-Object Name -like "zulu-17*" | Select-Object -First 1).FullName
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
[Environment]::SetEnvironmentVariable("JAVA_HOME", $jdk, "User")
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdk, "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $sdk, "User")
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$add = "$jdk\bin;$sdk\platform-tools;$sdk\cmdline-tools\latest\bin;$sdk\build-tools\36.0.0"
[Environment]::SetEnvironmentVariable("Path", "$add;$userPath", "User")
```

If `$jdk` comes out empty, find the JDK folder under `C:\Program Files\` (for example `Zulu\zulu-17`) and set it by
hand. **Close every terminal and open a new one** so the variables load.

### 2.6 Check the setup

Every line below must succeed before you continue:

```powershell
node -v                               # v22.x
java -version                         # ... version "17.x"
$env:ANDROID_HOME                     # C:\Users\<you>\AppData\Local\Android\Sdk
adb version                           # Android Debug Bridge ...
ls $env:ANDROID_HOME\ndk              # 27.1.12297006
ls $env:ANDROID_HOME\build-tools      # 36.0.0
ls $env:ANDROID_HOME\platforms        # android-36
ls $env:ANDROID_HOME\cmake            # 3.22.1
```

Optional but useful:

```powershell
winget install --id GitHub.cli -e     # gh: GitHub CLI, for releases (§8)
```

### 2.7 Windows Defender exclusions (Admin, recommended)

Real-time scanning inspects every file Gradle writes, which can double the build time. Excluding the project and the
caches avoids that:

```powershell
Add-MpPreference -ExclusionPath "C:\dev\jovi"
Add-MpPreference -ExclusionPath "$env:USERPROFILE\.gradle"
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Android\Sdk"
```

---

## 3. Get the code and the secrets

```powershell
mkdir C:\dev -Force | Out-Null
cd C:\dev
git clone -c core.autocrlf=false -b prod_app https://github.com/ArturFBrandi/jovi-lens-mobile-prod.git jovi
cd jovi
npm install
```

- All production work is on the **`prod_app`** branch, not `main`.
- `core.autocrlf=false` keeps the repository's LF line endings. With Git's Windows default, files get rewritten to
  CRLF and dozens show up as "modified" without any real change.

### 3.1 The `.env` file

`.env` is **not** in git (it's in `.gitignore`). Copy it from the machine that has it, through a private channel (an
encrypted note, a USB drive). Never paste it into a chat, an issue or a commit. Put it at the repository root,
`C:\dev\jovi\.env`.

For the **APK build**, only one value in `.env` matters:

| Variable | What it is |
| --- | --- |
| `EXPO_PUBLIC_JOVI_API_KEY` | The app key the APK sends as `x-api-key`. It **must equal** `JOVI_API_KEY` in the Vercel project, or every request fails with 401. |

Everything else in `.env` (MiniMax key, session secret and so on) is for running the backend locally. The production
backend reads its own copies from Vercel.

If you don't have the `.env`, you can still get the key from Vercel, if you have access to the project:

```powershell
npx vercel link                       # choose the jovi-lens-mobile-prod project
npx vercel env pull .env.vercel       # writes JOVI_API_KEY and the other vars
```

Then put `EXPO_PUBLIC_JOVI_API_KEY=<value of JOVI_API_KEY>` in `.env`, and delete `.env.vercel` once you're done.

> The `.env` file also contains `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8787`, which is meant for local development.
> **Don't edit it for a production build.** The build commands in §5 override it from the shell, and shell variables
> take precedence over `.env`.

---

## 4. The signing key (read this before building)

Google sign-in on Android only works when the APK is signed with a key whose **SHA-1 is registered** in the Google
Cloud OAuth client for `com.jovilens.app`. The one registered today is:

```
SHA-1: 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

This is the **React Native template debug keystore**. Every release so far is signed with it, and it lives at
`android\app\debug.keystore` (store password `android`, alias `androiddebugkey`, key password `android`).

What this means for you:

- **Sign with that same file.** If you sign with a different key, the app installs and opens, but the Google login
  fails with `DEVELOPER_ERROR`.
- **Phones keep app data across updates only when the signing key matches.** With a different key, Android refuses
  the update and testers must uninstall first.
- `android\` is gitignored, and `expo prebuild --clean` regenerates it, so **keep a copy of the keystore outside the
  repo**:

  ```powershell
  mkdir "$env:USERPROFILE\keys\jovi-lens" -Force | Out-Null
  # after the first prebuild (§5.2), or copied from the other machine:
  Copy-Item android\app\debug.keystore "$env:USERPROFILE\keys\jovi-lens\debug.keystore"
  ```

Check any keystore with:

```powershell
keytool -list -v -keystore "$env:USERPROFILE\keys\jovi-lens\debug.keystore" -storepass android -alias androiddebugkey | Select-String SHA1
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

Commit only `app.json` for the bump (`android\` is not tracked):

```powershell
git add app.json; git commit -m "chore: release v1.1.1 (versionCode 6)"
```

### 5.2 Set the production variables and generate the native project

Run everything from the repository root, **in the same PowerShell window**. `$env:` variables only last for that
window.

```powershell
$env:APP_VARIANT = "production"
$env:EXPO_PUBLIC_JOVI_LENS_DEMO_MODE = "false"
$env:EXPO_PUBLIC_API_BASE_URL = "https://jovi-lens-mobile-prod.vercel.app"
$env:EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = "301410724957-kk4jv0aaub13btl1mpdu1h711t4sk0op.apps.googleusercontent.com"
$env:NODE_ENV = "production"
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

Generate `android\`. This is needed the first time, and whenever native config changes: `app.json`, `app.config.js`,
plugins, or native dependencies.

```powershell
npx expo prebuild --platform android --clean
Copy-Item "$env:USERPROFILE\keys\jovi-lens\debug.keystore" android\app\debug.keystore -Force   # restore the key (§4)
```

If you don't have a saved keystore yet, check the one prebuild generated (§4). If its SHA-1 matches, save a copy now.

### 5.3 Compile

```powershell
cd android
.\gradlew.bat assembleRelease
cd ..
```

- The first build downloads Gradle and the Maven dependencies, and compiles C++ for four processor types, so it is
  slow: expect **20–40 minutes**. Later full builds are faster, and a JS-only change rebuilds in a few minutes (§9.2).
- If the build is killed for memory on an 8 GB PC, add `--no-daemon --max-workers=2`.
- The output is a **universal APK** (all four ABIs, about 150 MB). That's what the GitHub releases ship. For an
  arm64-only APK (about 3× smaller and much faster to build; works on every modern phone but not on 32-bit or x86
  devices), add `-PreactNativeArchitectures=arm64-v8a`.

The result is at:

```
android\app\build\outputs\apk\release\app-release.apk
```

---

## 6. Verify the APK before you ship it

A build can succeed and still be wrong: a stale bundle, the wrong URL, or the wrong key. The checks below take a minute
and catch all of these. Run them in PowerShell from the repository root.

```powershell
$apk = "android\app\build\outputs\apk\release\app-release.apk"

# 1. Signed with the registered key?
apksigner.bat verify --print-certs $apk | Select-String "SHA-1"
#    → 5e8f16062ea3cd2c4a0d547876baa6f38cabf625

# 2. Right version, package, and HTTPS-only?
aapt2 dump badging $apk | Select-Object -First 1
#    → package: name='com.jovilens.app' versionCode='5' versionName='1.1.0' ...
aapt2 dump xmltree $apk --file AndroidManifest.xml | Select-String "usesCleartextTraffic|allowBackup"
#    → both must be false (0x0)

# 3. Points at production, not localhost?
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $apk))
$reader = New-Object IO.BinaryReader($zip.GetEntry("assets/index.android.bundle").Open())
$bundle = [Text.Encoding]::ASCII.GetString($reader.ReadBytes(300MB)); $zip.Dispose()
$bundle.Contains("jovi-lens-mobile-prod.vercel.app")    # True
$bundle.Contains("127.0.0.1:8787")                      # False

# 4. Checksum for the release notes
(Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
```

> The bundle is **Hermes bytecode**, not JavaScript text, so only string literals can be found. Use ASCII-only search
> strings: text with accents (`Período`) is stored as UTF-16 and won't match.

---

## 7. Install it on a phone

### 7.1 USB

1. On the phone, open **Settings → About phone** and tap **Build number** 7 times. Then open **Settings → System →
   Developer options** and turn on **USB debugging**.
2. Connect the cable, and accept the "Allow USB debugging?" prompt on the phone.
3. Install:

```powershell
adb devices                       # the phone must show as "device", not "unauthorized"
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

`-r` keeps the app's data. That only works when the installed app has the same signing key and a lower versionCode.

> **The phone doesn't show up in `adb devices`?** Windows needs an ADB driver for it. Most phones work with the
> driver Windows installs automatically. For Pixel phones, install the **Google USB Driver** (§2.4). For other brands,
> install the maker's driver (Motorola Device Manager, Samsung USB Driver and so on). Also switch the phone's USB mode
> to **File transfer**, and try another cable: many cables only charge.

> **Coming from v1.0.4 or older (demo builds)?** The data isn't migrated. Uninstall first:
> `adb uninstall com.jovilens.app`.

### 7.2 Wireless debugging (no driver needed)

The PC and the phone must be on the same Wi-Fi network. On the phone, open **Developer options → Wireless debugging →
Pair device with pairing code**.

```powershell
adb pair <phone-ip>:<pairing-port> <6-digit-code>
adb connect <phone-ip>:<connect-port>     # a different port, shown on the Wireless debugging screen
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

If Windows Firewall asks about `adb.exe`, allow it on **private** networks.

### 7.3 Without adb

Send the APK to the phone (Google Drive, a GitHub release link, or `python -m http.server 8000` in the APK folder,
then open `http://<pc-ip>:8000/app-release.apk` in the phone's Chrome). Open the file and allow **Install unknown
apps** for the browser.

### 7.4 Smoke test on the device

1. Open the app. The **Hoje** screen shows "Seu plano começa com uma foto", with no sample data.
2. Sign in with Google. The profile shows **3 free interactions**.
3. Take or import a photo of notes, and analyze it. The answer is in Portuguese, and the credits go down by one.
4. Save it, open **Notas → the subject → Estúdio → Gerar perguntas**. The questions appear.
5. After the 3rd interaction, the "Interações gratuitas esgotadas" dialog appears.
6. **Perfil → Sair** signs out, and stays signed out after the app restarts.

To read JS errors from the device:

```powershell
adb logcat -c; adb logcat | Select-String "ReactNativeJS|FATAL EXCEPTION"
```

---

## 8. Publish a GitHub release

```powershell
gh auth login                                             # once
Copy-Item android\app\build\outputs\apk\release\app-release.apk jovi-lens-v1.1.1.apk
git tag v1.1.1; git push origin prod_app v1.1.1
gh release create v1.1.1 jovi-lens-v1.1.1.apk `
  -R ArturFBrandi/jovi-lens-mobile-prod `
  --title "JOVI Lens v1.1.1 (Android)" `
  --notes-file release-notes.md
Remove-Item jovi-lens-v1.1.1.apk
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

For **presentation**: set `$env:APP_VARIANT = "presentation"` and `$env:EXPO_PUBLIC_JOVI_LENS_DEMO_MODE = "true"`, then
do the same prebuild and Gradle steps. It needs no API key or URL.

For **development** (local backend): run the API with `node --env-file=.env server/local-api.js`, build with
`APP_VARIANT=development` and the default `.env` URL, then tunnel the phone to your PC with
`adb reverse tcp:8787 tcp:8787`. `scripts/phone-dev.sh` does the pairing, the tunnel and the server in one command:
run it from **Git Bash** (`bash scripts/phone-dev.sh <ip>:<port> <code>`). See `ANDROID_BUILD.md` §5. For live reload
during development, use `npx expo run:android`.

### 9.2 JS-only rebuild (much faster)

If you only changed JavaScript (screens, services, `shared/`), **don't run prebuild again**. Rerun Gradle only, in a
window where the §5.2 variables are set:

```powershell
Remove-Item -Recurse -Force android\app\build\generated\assets\react\release, android\app\build\generated\res\react\release -ErrorAction SilentlyContinue
cd android; .\gradlew.bat assembleRelease; cd ..
```

The `Remove-Item` matters. **Gradle doesn't track `.env` or `EXPO_PUBLIC_*` changes**, so without it the build can
reuse the old JS bundle. Then the APK silently keeps the old URL or the old demo flag.

Run prebuild again (§5.2) when you change `app.json`, `app.config.js`, config plugins, or add or upgrade a package
that has native code, then restore the keystore.

### 9.3 EAS cloud build (alternative)

`eas build -p android --profile production` builds in the cloud, using the variables from `eas.json`. No local
toolchain is needed, which is handy on a slow PC. EAS signs with **its own** keystore, so add that SHA-1 (shown by
`eas credentials -p android`) to the Android OAuth client first, or Google login fails. It also sets
`EXPO_PUBLIC_JOVI_API_KEY` as an EAS environment variable (sensitive). Testers who have a locally signed build must
uninstall before installing an EAS one.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Filename longer than 260 characters` / CMake `path too long` / `ninja: error: … No such file` | Windows path limit | Enable long paths (§2.1), and move the repo to a short path like `C:\dev\jovi` |
| `Unsupported class file major version 65` / Gradle fails right away | Gradle is running with JDK 21+ | Set `JAVA_HOME` to JDK 17 (§2.5), open a new terminal, and check `java -version` |
| `'adb' / 'keytool' / 'aapt2' is not recognized` | PATH not loaded | Open a new terminal after §2.5, and check `$env:Path` |
| `SDK location not found` | `ANDROID_HOME` not set | Redo §2.5, or create `android\local.properties` with `sdk.dir=C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk` |
| `NDK not configured` / `[CXX1101] NDK at … did not have a source.properties` | Wrong or partial NDK | Reinstall NDK 27.1.12297006 in the SDK Manager; delete a broken folder under `%ANDROID_HOME%\ndk\` first |
| `Unable to delete file` / `being used by another process` | Gradle daemon, antivirus or OneDrive holding a file | `.\gradlew.bat --stop`, add the Defender exclusions (§2.7), keep the repo out of OneDrive |
| `running scripts is disabled on this system` (npx/npm) | PowerShell execution policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Build is extremely slow | Defender scanning, or the repo is on a slow or network drive | §2.7 exclusions; local SSD; or build arm64-only |
| Gradle killed / `Daemon disappeared` | Out of memory | `.\gradlew.bat assembleRelease --no-daemon --max-workers=2`; close other apps |
| App closes right after opening | `EXPO_PUBLIC_API_BASE_URL` missing or not `https://` in a non-development build | Set the §5.2 variables, delete the generated bundle (§9.2), rebuild |
| Google login: `DEVELOPER_ERROR` | APK signed with a key whose SHA-1 isn't registered | Sign with the `5E:8F…F6:25` keystore (§4), or register the new SHA-1 |
| Every request: 401 / "chave do app" | `EXPO_PUBLIC_JOVI_API_KEY` ≠ Vercel `JOVI_API_KEY` | Fix `.env`, delete the generated bundle, rebuild |
| `CLEARTEXT communication not permitted` | An HTTPS-only build is pointed at an `http://` URL | Use the Vercel URL, or build `APP_VARIANT=development` for local work |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | The installed app was signed with another key | `adb uninstall com.jovilens.app`, then install (this erases app data) |
| `INSTALL_FAILED_VERSION_DOWNGRADE` | versionCode isn't higher than the installed one | Bump `versionCode` in `app.json`, prebuild, rebuild |
| APK still has the old URL, flag or text | Stale bundle reused by Gradle | Delete the generated bundle folders (§9.2), rebuild |
| Dozens of files "modified" in `git status` with no real change | CRLF line-ending conversion | `git config core.autocrlf false`, then `git checkout -- .` (only if you have no real changes) |
| `adb devices` empty or `unauthorized` | Missing USB driver, charge-only cable, or prompt not accepted | §7.1 driver note; accept the prompt on the unlocked phone; or use wireless debugging |

Logs from a failed build: `.\gradlew.bat assembleRelease --stacktrace`, and look for the first `FAILURE:` block.

---

## 11. Quick reference

Once the toolchain is installed, a full production release looks like this, in PowerShell:

```powershell
cd C:\dev\jovi
git pull; npm install
# bump expo.version and expo.android.versionCode in app.json, commit

$env:APP_VARIANT = "production"; $env:EXPO_PUBLIC_JOVI_LENS_DEMO_MODE = "false"; $env:NODE_ENV = "production"
$env:EXPO_PUBLIC_API_BASE_URL = "https://jovi-lens-mobile-prod.vercel.app"
$env:EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = "301410724957-kk4jv0aaub13btl1mpdu1h711t4sk0op.apps.googleusercontent.com"

npx expo prebuild --platform android --clean
Copy-Item "$env:USERPROFILE\keys\jovi-lens\debug.keystore" android\app\debug.keystore -Force
cd android; .\gradlew.bat assembleRelease; cd ..

$apk = "android\app\build\outputs\apk\release\app-release.apk"
apksigner.bat verify --print-certs $apk | Select-String "SHA-1"     # 5e8f…f625
(Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
adb install -r $apk
```

---

## 12. Building in WSL instead

Building inside WSL (Ubuntu) also works. It's the setup the project was first built on, documented in Portuguese in
`ANDROID_BUILD.md` §1–4: Linux JDK 17, SDK and NDK under `$HOME`, and the bash commands from `BUILD-APK-MACOS.md` §5–6,
with Linux paths. Two things to know:

- **Keep the repo inside the Linux filesystem** (`~/dev/jovi`), not under `/mnt/c` or `/mnt/d`. From `/mnt/d`, every
  file access crosses the WSL↔Windows boundary, and a full build took **45–55 minutes**, against a fraction of that on
  native disk.
- **Phones:** USB devices aren't visible in WSL without `usbipd-win`, and WSL doesn't receive mDNS, so the wireless
  connect port must be found by a port scan. Installing from Windows' own `adb.exe` is simpler:
  `adb.exe install -r \\wsl$\Ubuntu\home\<you>\dev\jovi\android\app\build\outputs\apk\release\app-release.apk`.

Related docs: `BUILD-APK-MACOS.md` (the same guide for macOS), `HANDOFF.md` (whole-project guide: backend, Vercel,
OAuth, lessons learned), `ANDROID_BUILD.md` (WSL build guide plus device debugging), `eas.json` (variant variables).
