# Android shell

| Lives in                                                           | What                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/android/main.ts`, `src/android/index.html`                    | Composition root: builds the AppApi over the native port and mounts the Android UI        |
| `src/android/ui/`                                                  | The phone interface: screens, state (`store.ts`), strings (`i18n.ts`), tokens (`styles.css`) |
| `src/android/ui/downloadPlan.ts`                                   | Probe → queue items, through the shared profile resolver and job builder                  |
| `src/android/createAndroidAppApi.ts`                               | The `AppApi` (same contract as the Electron preload) backed by the Android core           |
| `src/android/queue.ts`, `jobRunner.ts`                             | The download queue and one item's run (media, soft subtitles, publish)                   |
| `src/android/probe.ts`, `ytDlpArgs.ts`                             | Probe and argv, through the shared planner and probe mapping                              |
| `src/android/nativePort.ts`, `capacitorAdapter.ts`                 | The port to the native side and its Capacitor adapter (replies parsed with zod)           |
| `src/android/storage.ts`                                           | Settings and queue persistence (localStorage, read back through the shared schemas)       |
| `src/android/vite.config.ts`, `src/android/shims/`                 | WebView build; `node:path`/`os`/`fs` shims for yt-dlp-bridge's planner                    |
| `android/app/src/main/java/com/arroxy/app/ArroxyNativePlugin.java` | Native plugin: runs yt-dlp, publishes to `Download/Arroxy`, opens files, receives shares  |
| `android/app/src/main/java/com/arroxy/app/KeepAliveService.java`   | Foreground service that keeps downloads running in the background                        |
| `android/app/src/main/res/`                                        | Adaptive + themed launcher icon and Android 12+ splash, all vector                        |
| `capacitor.config.json`, `.github/workflows/android.yml`           | Capacitor project config; CI that builds the APKs                                         |
| `tests/unit/android-*.test.ts`                                     | Argv, probe, queue, storage, download plan, UI state and formatting tests                 |

## How it is put together

Android has its own interface, built for a phone, and its own look. The desktop
renderer is not in the APK. Both talk to core through the same `AppApi`
contract: on desktop it is the Electron preload, on Android
`createAndroidAppApi` over the native port.

Core runs in the WebView, not in native code. Queue, probe mapping, yt-dlp argv
planning and job building are the same TypeScript desktop uses
(`@shared/mediaRequest`, `@shared/ytdlp/probeMapping`, `@shared/queueTransition`,
`@shared/prepareJob`, `@shared/downloadProfiles`, yt-dlp-bridge's
`planWorkflow`). The native plugin only does what a WebView cannot: run a
process, kill it, move files into shared storage, open a file, and hand over
text shared from another app. See
[ADR 0009](../docs/adr/0009-android-runs-core-in-the-webview.md).

yt-dlp, Python and ffmpeg come from
[youtubedl-android](https://github.com/JunkFood02/youtubedl-android). The plugin
updates yt-dlp from the nightly channel at every warmup, the channel desktop
uses, so site fixes arrive without an app release.

Each queue item downloads into its own app-private directory
(`<filesDir>/arroxy/jobs/<itemId>`). Pause kills the process and keeps the
directory, so resume continues the `.part` files. When the run succeeds every
finished file is copied into `Download/Arroxy/` through MediaStore (a playlist
gets its own subfolder), and the job directory is deleted.

## The interface

Three destinations in a bottom navigation bar: **Download** (paste or share a
link, look it up, pick a quality, download; playlists get a selectable list),
**Downloads** (in progress / finished, pause, resume, cancel, retry, open the
saved file), **Settings** (theme, default quality, downloads at once, speed
limit, proxy, storage folder, versions).

- **Share → Arroxy.** The activity accepts `ACTION_SEND` text, so a link shared
  from YouTube or any app opens straight into its result. The first link in the
  shared text is kept, without tracking parameters.
- **Quality choices** are the built-in download profiles (`best-quality`,
  `hd-1080`, `balanced`, `small-file`, `audio-only`); the choice is stored as the
  active profile, so the phone and the desktop vocabulary agree.
- **Back gesture.** Each step into the app pushes a history entry; Android's back
  pops it (result → home, other tab → Download, then exit).
- **Edge to edge.** Capacitor's `SystemBars` injects the insets
  (`--safe-area-inset-*`); the status-bar icons follow the theme.
- **Strings** live in `ui/i18n.ts`: English and Portuguese, picked from the
  device language. The desktop catalog is not used: the phone UI has its own,
  much smaller vocabulary.

### Visual identity

Deliberately not the desktop's (no mascot, no blue glass, no Poppins):

- **Mark:** the "drop" — a file falling into the phone, with an arrow cut into it
  and the ground it lands on, on an ember tile. Vector everywhere (`ui/Logo.tsx`,
  `res/drawable/ic_launcher_*.xml`, `splash_icon.xml`), with a monochrome layer
  for Android 13+ themed icons.
- **Colour:** warm paper and ember coral in light, warm graphite in dark; tokens
  in `ui/styles.css`, switched by `data-theme`.
- **Type and shape:** the phone's own typeface (Google Sans / Roboto), Material-
  style pills, large rounded cards, a bottom navigation bar with a pill indicator.

## Build

Needs the Android SDK (platform 36, build-tools 36) and JDK 21.

```bash
bun run android:apk          # WebView bundle → cap sync → ./gradlew assembleDebug
bun run android:build:web    # only the WebView bundle (out/android-web)
bun run android:sync         # bundle + copy into android/
```

The APKs land in `android/app/build/outputs/apk/debug/`, one per ABI
(`app-arm64-v8a-debug.apk` is the one for almost every current phone). Each ships
its own Python and ffmpeg. `bun run android:apk:release` builds unsigned release
APKs; signing is not set up. The version name and code come from the root
`package.json`.

## What is not there yet

- **No JS runtime for YouTube.** youtubedl-android ships no Deno/Node/QuickJS and
  there is no PO-token minting, so some YouTube formats can be missing or blocked
  where desktop would get them.
- **Not on Android:** sign-in (Explore) and cookies, subtitles and SponsorBlock
  choices, custom download profiles and filename templates, automatic retry,
  playlist `.m3u`, choosing an output folder (everything goes to `Download/Arroxy`),
  diagnostics upload, in-app updates. Strings exist in English and Portuguese only.
- **Android 10+ only** (`minSdk 29`), for MediaStore's `RELATIVE_PATH`.
- **Not verified on a device in CI.** The workflow builds the APKs; the WebView
  half is covered by unit tests and was driven end to end in Chromium at phone
  size with a faked Capacitor bridge running a real yt-dlp (share → download,
  pause/resume, errors, both themes). Runs on real phones still need checking:
  ffprobe-dependent post-processing relies on what youtubedl-android's ffmpeg
  package provides.
