# Android shell

| Lives in                                                        | What                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/android/main.ts`                                           | Composition root: installs the AppApi, then boots the unchanged renderer              |
| `src/android/createAndroidAppApi.ts`                            | The `AppApi` the renderer talks to on Android                                         |
| `src/android/queue.ts`, `jobRunner.ts`                          | The download queue and one item's run (media, soft subtitles, publish)               |
| `src/android/probe.ts`, `ytDlpArgs.ts`                          | Probe and argv, through the shared planner and probe mapping                          |
| `src/android/nativePort.ts`, `capacitorAdapter.ts`              | The port to the native side and its Capacitor adapter (replies parsed with zod)       |
| `src/android/storage.ts`                                        | Settings and queue persistence (localStorage, read back through the shared schemas)   |
| `src/android/vite.config.ts`, `src/android/shims/`              | WebView build; `node:path`/`os`/`fs` shims for yt-dlp-bridge's planner                |
| `android/app/src/main/java/com/arroxy/app/ArroxyNativePlugin.java` | Native plugin: runs yt-dlp, cancels, publishes files to `Download/Arroxy`             |
| `android/app/src/main/java/com/arroxy/app/KeepAliveService.java` | Foreground service that keeps downloads running in the background                    |
| `capacitor.config.json`, `.github/workflows/android.yml`        | Capacitor project config; CI that builds the APKs                                     |
| `tests/unit/android-shell.test.ts`                              | Argv, probe, queue and storage tests against a fake native port                       |

## How it is put together

The renderer is the desktop renderer, byte for byte. `src/android/vite.config.ts`
builds `src/renderer/index.html` but swaps its entry for `src/android/main.ts`,
which puts an `AppApi` on `window` before the renderer boots — exactly what the
Electron preload does. The renderer cannot tell the shells apart.

Core runs in the WebView, not in native code. Queue, probe mapping and yt-dlp argv
planning are the same TypeScript desktop uses (`@shared/mediaRequest`,
`@shared/ytdlp/probeMapping`, `@shared/queueTransition`, yt-dlp-bridge's
`planWorkflow`). The native plugin only does what a WebView cannot: run a process,
kill it, and move files into shared storage. See
[ADR 0009](../docs/adr/0009-android-runs-core-in-the-webview.md) for why.

yt-dlp, Python and ffmpeg come from
[youtubedl-android](https://github.com/JunkFood02/youtubedl-android)
(`io.github.junkfood02.youtubedl-android`). It bundles a yt-dlp build in the APK and
the plugin updates it from the nightly channel at every warmup, the same channel
desktop uses, so site fixes arrive without an app release.

Each queue item downloads into its own app-private directory
(`<filesDir>/arroxy/jobs/<itemId>`). Pause kills the process and keeps the
directory, so resume continues the `.part` files. When the run succeeds, every
finished file is copied into `Download/Arroxy/` through MediaStore (keeping any
subfolders the filename template made) and the job directory is deleted.

## Build

Needs the Android SDK (platform 36, build-tools 36) and JDK 21.

```bash
bun run android:apk          # WebView bundle → cap sync → ./gradlew assembleDebug
bun run android:build:web    # only the WebView bundle (out/android-web)
bun run android:sync         # bundle + copy into android/
```

The APKs land in `android/app/build/outputs/apk/debug/`, one per ABI
(`app-arm64-v8a-debug.apk` is the one for almost every current phone). Each ships
its own Python and ffmpeg, so a universal APK would be ~210 MB.
`bun run android:apk:release` builds unsigned release APKs; signing is not set up.
The version name and code come from the root `package.json`.

## What is not there yet

- **Phone layout.** The renderer is designed for windows ≥ 720 px wide. It works in
  a phone's portrait width, but tab labels and the queue table are cramped. Tablets
  and landscape are fine. A responsive pass is the main open item.
- **No JS runtime for YouTube.** youtubedl-android ships no Deno/Node/QuickJS, and
  there is no PO-token minting, so some YouTube formats can be missing or blocked
  where desktop would get them.
- **Desktop-only surfaces** answer "not available": global hotkey, tray, clipboard
  watch, Explore (the in-app browser, and therefore signed-in downloads), cookies
  from a file or browser, the in-app updater, diagnostics upload, and choosing an
  output folder (everything goes to `Download/Arroxy`).
- **No automatic retry, playlist `.m3u` or folder sync** — the Android queue is the
  core queue contract without those extras.
- **Android 10+ only** (`minSdk 29`), for MediaStore's `RELATIVE_PATH`.
- **Not verified on a device in CI.** The workflow builds the APKs; the
  WebView half is covered by unit tests and was exercised end to end in Chromium
  with a faked Capacitor bridge running a real yt-dlp. Runs on real phones still
  need checking: ffprobe-dependent post-processing in particular relies on what
  youtubedl-android's ffmpeg package provides.
