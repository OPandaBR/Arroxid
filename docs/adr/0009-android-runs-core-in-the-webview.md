# Android runs core in the WebView and keeps native code to a process port

The Android app reuses the desktop renderer inside a Capacitor WebView and runs
the queue, probe mapping and yt-dlp argv planning there too, in the same
TypeScript desktop uses. Native code (one Capacitor plugin) only runs yt-dlp,
cancels it, and moves finished files into shared storage. yt-dlp, Python and
ffmpeg come from youtubedl-android.

The alternatives were a native rewrite of core in Kotlin, or Node on the device
(nodejs-mobile) running Electron main with its Electron imports stubbed. A
Kotlin core would fork every rule desktop has — format selection, filename
templates, subtitle phases, probe mapping — into a second implementation that
drifts. Node on the device would run main as-is, but main is written against
Electron, the PO-token window and a JS runtime that do not exist there, and it
would add a second runtime to the APK beside Python. Running core in the
WebView keeps one implementation of those rules, and the native surface stays
small enough to read in one sitting.

The cost is that core must stay importable in a browser: the pure parts of
probe mapping, the media request and the output-template compiler moved from
`src/main` to `src/shared`, and yt-dlp-bridge's planner is bundled with tiny
`node:path`/`os`/`fs` shims for the config it reads at import time.
`nativePort.ts` is a port with one production adapter, which ADR 0005 calls a
defect; it is kept because it is the trust boundary to native code (every reply
is parsed there) and the seam the queue tests run against.

## Consequences

Core logic added to `src/main` does not reach Android until it is pure and lives
in `src/shared`. Android lags desktop on anything that needs a capability the
WebView or youtubedl-android lacks (Explore sign-in, a JS runtime, PO tokens),
and those surfaces answer "not available" rather than failing.
