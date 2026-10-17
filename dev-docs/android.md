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
| `android/app/src/main/java/com/arroxy/app/ArroxyNativePlugin.java` | Native plugin: yt-dlp, files, share sheet, clipboard, notifications, cookies picker       |
| `android/app/src/main/java/com/arroxy/app/LaunchIntents.java`      | Share targets, "Download now", selected-text menu and launcher shortcuts → one launch     |
| `android/app/src/main/java/com/arroxy/app/SharedStorage.java`      | Download/Arroxy through MediaStore: publish, find a saved file                            |
| `android/app/src/main/java/com/arroxy/app/DownloadNotifications.java`, `KeepAliveService.java` | Live progress notification (foreground service) and finished/failed notifications |
| `src/android/ui/notices.ts`, `src/android/updateCheck.ts`          | What the notifications say, and the release check                                         |
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

## Desktop integrations, and what they became on Android

Every integration the desktop app has with its operating system was checked
against what Android offers; each has a phone counterpart or a stated reason not to.

| Desktop                                                               | Android                                                                                                                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Global hotkey: queue the copied link with the active profile, no window | **"Download now"** share target (an `activity-alias`): queues a video with the active quality, confirms in a notification and returns to the app the link came from. A playlist still opens for review. |
| Paste / drop a link                                                   | "Share → Arroxy" (review), **"Arroxy" in the selected-text menu** (`PROCESS_TEXT`), launcher shortcuts **Paste link** and **Downloads**, native Paste button.                                              |
| Clipboard watch (only while the window is focused)                    | When Arroxy comes back to the front, a link copied since the last look is offered on Download. Only a newer clip is read (its timestamp is checked first), so Android's "pasted from clipboard" toast shows once per clip. Same setting, on by default. |
| Tray: downloads go on with the window closed                          | Foreground service with a **live progress notification** (title, %, speed, ETA, waiting count) and a **Pause all** action.                                                                                 |
| OS notifications                                                      | One notification per finished (tap opens the file) or failed download, while Arroxy is not in front.                                                                                                       |
| Open folder / reveal file                                             | Open the Downloads app; open a saved file in the app the user picks; **share a saved file** through the share sheet.                                                                                      |
| Cookies from a file                                                   | System file picker → private copy → `--cookies`, the desktop's `file` cookies mode.                                                                                                                        |
| Save / upload diagnostics, feedback form                              | **Share details** on a failed download (title, link, reason, yt-dlp output, versions) through the share sheet.                                                                                             |
| Share Arroxy                                                          | Settings → Share Arroxy, through the share sheet.                                                                                                                                                          |
| Update banner                                                         | The latest GitHub release is offered (Download screen and Settings) when it is newer **and ships an APK**. Releases do not ship one yet, so nothing shows until the release pipeline publishes it.          |
| Window controls, zoom, GPU backdrop, close-to-tray choice             | Not applicable: the OS owns the task; text follows the system.                                                                                                                                             |
| Explore (in-app browser sign-in)                                      | **Not ported.** Google refuses sign-in inside an embedded WebView, so the session could not be created; the cookies file covers age-restricted and members-only videos instead.                            |
| Cookies from an installed browser                                     | Not possible: Android apps cannot read another app's cookies.                                                                                                                                              |
| Daily heartbeat                                                       | **Not ported, pending a decision**: it reports to a server, and the dashboard has no Android platform yet.                                                                                                 |
| Hotkey rebinding, homebrew/winget repair, binaries folder             | Not applicable.                                                                                                                                                                                            |

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
- **Not on Android:** Explore sign-in and browser cookies (see the table above), subtitles and SponsorBlock
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
