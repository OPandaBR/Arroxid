# Android runs core in the WebView, behind its own phone UI

The Android app runs the queue, probe mapping, yt-dlp argv planning and job
building in a Capacitor WebView, in the same TypeScript desktop uses. Its
interface is its own, built for a phone, with its own visual identity and its
own name, **Pingo**; it talks
to core through the same `AppApi` contract as the desktop renderer. Native code
(one Capacitor plugin) only runs yt-dlp, cancels it, moves finished files into
shared storage, opens them, and hands over shared text. yt-dlp, Python and ffmpeg
come from youtubedl-android.

For core, the alternatives were a native rewrite in Kotlin, or Node on the device
(nodejs-mobile) running Electron main with its Electron imports stubbed. A
Kotlin core would fork every rule desktop has — format selection, filename
templates, subtitle phases, probe mapping — into a second implementation that
drifts. Node on the device would run main as-is, but main is written against
Electron, the PO-token window and a JS runtime that do not exist there, and it
would add a second runtime to the APK beside Python.

For the interface, reusing the desktop renderer was tried first and dropped: it
is laid out for windows of 720 px and more, and in a phone's portrait width its
tabs and queue table broke apart. A phone UI over the same `AppApi` keeps the
contract in one place while each shell owns how it looks.

The cost is that core must stay importable in a browser: the pure parts of
probe mapping, the media request and the output-template compiler live in
`src/shared`, and yt-dlp-bridge's planner is bundled with tiny
`node:path`/`os`/`fs` shims for the config it reads at import time.
`nativePort.ts` is a port with one production adapter, which ADR 0005 calls a
defect; it is kept because it is the trust boundary to native code (every reply
is parsed there) and the seam the queue and UI tests run against.

## Consequences

Core logic added to `src/main` does not reach Android until it is pure and lives
in `src/shared`. A desktop feature does not appear on Android until the phone UI
grows a surface for it. Android lags desktop on anything that needs a capability
the WebView or youtubedl-android lacks (Explore sign-in, a JS runtime, PO tokens),
and those AppApi surfaces answer "not available" rather than failing.
