# General

## Engineering Principles

The defaults below apply to every change in this codebase.

- **Type safety throughout.** Favor strict typing, exhaustive checks, and discriminated unions. `any` is never acceptable in production code — it disables checking rather than describing a boundary. Use `unknown` instead, and narrow it as below.
- **Validate at trust transitions.** Data received from IPC, persistence, external processes, network responses, environment/configuration, browser evaluation, and untyped framework APIs enters as `unknown` when its runtime shape is not guaranteed. Convert it through an owned parser or normalizer into a named trusted type before domain logic consumes it. Parsers may accept `unknown` and use runtime checks. Runtime narrowing remains valid for typed unions, optional values, capability detection, and error normalization. Prefer schemas, type guards, contextual typing, and discriminated unions over assertions. A necessary assertion must be supported by a locally visible check or a precise documented invariant.
- **Clean architecture.** Keep concerns separated, dependencies pointing inward, business logic decoupled from frameworks and I/O. The renderer shouldn't know how the main process fetches; the main process shouldn't know which component renders.
- **Prefer mature libraries over bespoke code.** For validation, HTTP, ORM, auth, logging, and similar plumbing, reach for the production-proven, widely-adopted package before writing your own. If a mature library solves the problem, use it.
- **Push back when something looks wrong.** Don't defer to the user reflexively. If a proposal looks incorrect, incomplete, or inconsistent with the codebase, name the specific reason rather than agreeing. Agreement-by-default is a failure mode.
- **Verify before you act on uncertainty.** When you're not confident about a fact, an API surface, a library's behavior, or how a piece of this codebase works, check it — read the source, check the docs, run a quick test. Assumed knowledge is the most common source of bugs.
- **Reuse the domain glossary** in `GLOSSARY.md` — the canonical naming reference for the architecture. Use those terms exactly when extending or refactoring; add new entries when extracting modules instead of letting parallel vocabularies sprout.
- Don’t fight errors! Whenever you encounter the same error 3 times, research the web (and github using gh api) and find 3-5 possible ways to fix it. Then choose the most efficient solution and implement it or stop to notify user that there is no clean fix at this point.

---

## Repo Layout — this is a monorepo

Arroxy is a Bun workspace (`workspaces: ["packages/*"]`), not a single app:

- `src/` — the Electron app (`main` / `preload` / `renderer` / `shared`).
- `src/android/` + `android/` — the Android shell, shipped as **Pingo** (`com.arroxy.pingo`): its own name, phone UI (not the desktop renderer) in a Capacitor WebView over the same `AppApi`, queue and probe in TS, yt-dlp via youtubedl-android. See [`dev-docs/android.md`](dev-docs/android.md).
- `packages/yt-dlp-bridge` — yt-dlp workflow planning, argv generation, process execution, output parsing. Published as `yt-dlp-bridge` on npm; the app consumes it via `workspace:*`.
- `packages/ytdlp-errors` — structured yt-dlp error taxonomy. Published as `ytdlp-errors` on npm; `yt-dlp-bridge` depends on it.

**Both packages live in this repo — never clone them separately.** "Publishable package" in the tooling contract below means published *from here*, not maintained elsewhere.

Gates after touching either package:

```bash
bun run errors:check   # ytdlp-errors: typecheck + test + build + pack:dry-run
bun run bridge:check   # yt-dlp-bridge: builds ytdlp-errors first, then the same chain
```

Publishing is **not** part of the app release. Each package ships on its own annotated tag — `yt-dlp-bridge-v*.*.*` and `ytdlp-errors-v*.*.*` (`.github/workflows/publish-*.yml`), or manual `workflow_dispatch`. Pushing to `main` publishes nothing. So a package change is a separately-released change: keep it off the critical path of an app-side fix that does not need it.

---

## Domain Glossary

Use the canonical glossary in [`GLOSSARY.md`](./GLOSSARY.md).

The glossary is the single source of terminology for this repo. Keep it implementation-free (no module names, file paths, or migration notes) and update it when vocabulary decisions change. This prevents ambiguous PR reviews and keeps architecture and UX aligned.

### What is an ADR?

An ADR (Architecture Decision Record) is a short, high-signal note for a design decision that is:

- hard to reverse,
- surprising without context,
- and chosen through a real trade-off.

Use `docs/adr/0001-slug.md` style files for those decisions. Keep them concise.

### ADR creation rules

- Create [`docs/adr/`](./docs/adr/) only when the first ADR is needed.
- Use sequential file names: `0001-...`, `0002-...`, and so on.
- Skip ADRs for reversible or obvious implementation choices.

---

## Working Conventions

**No backward compatibility** — Do not prioritize migration paths, backward compatibility shims, or preserving existing implementations. Existing code can be discarded or restructured without ceremony. Skip any "keep for compat" hedging. Delete old types, old components, old state fields without re-exporting or aliasing. Refactor aggressively. No deprecation notices or transitional layers.

**schemas.ts is SSOT for all enum types.** Pattern: `z.enum([...])` → `type Foo = z.infer<…>` → `const FOOS = fooSchema.options`. Don't redeclare as TS union literals. `QUEUE_STATUS` / `STATUS_KEY` live in `schemas.ts` (not `constants.ts`). `DEFAULTS` lives in `constants.ts`.

**TDD for non-trivial changes.** Write failing tests first, implement minimally, then refactor. Skip only for typo fixes and single-line edits.

**`bunx`, never `npx`.** Run one-off package CLIs with `bunx` (e.g. `bunx skills find <query>`, `bunx skills add <owner/repo@skill>`), even when a skill or upstream doc says `npx`. Inside this checkout `npx` fails with `EOVERRIDE` (`Override for @types/react@… conflicts with direct dependency`) because the root `overrides` apply to npm's package runner; `bunx` ignores them. `check:tooling-contract` already rejects npm-family commands in tracked tooling and docs.

**Translation workflow.** Use the `translate-arroxy-i18n` project skill for app locale changes, PO/POT sync, generated locale JSON, and i18n audits.

**Session scope.** Treat every agent session as scoped to the task context it was given. Other agents may be working in parallel on the same branch, so do not repair, reformat, revert, or restructure files outside your current scope just because you notice a problem there.

### Agent Skills

- **translate-arroxy-i18n** — manages app locale updates, gettext PO/POT sync, runtime locale JSON generation, and i18n audit commands. Entry point: `.agents/skills/translate-arroxy-i18n/SKILL.md`.
- **ship-fix** — runs the end-to-end flow for a bug fix: worktree, test-first fix, PR, CodeRabbit, CI validation, squash-merge, version bump and release, with cheaper subagents for mechanical work. Entry point: `.agents/skills/ship-fix/SKILL.md`.

---

## Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State assumptions explicitly. Ask if uncertain.
- Multiple interpretations? Present them — don't pick silently.
- Simpler approach exists? Say so. Push back when warranted.
- Unclear? Stop. Name what's confusing. Ask.

## Goal-Driven Execution

**Define success criteria. Loop until verified.** Transform tasks into verifiable goals: "Add validation" → tests for invalid inputs, then make them pass. "Fix the bug" → reproduce-test, then make it pass. "Refactor X" → tests pass before and after. For multi-step tasks, state a brief plan with a `verify:` line per step.

For multi-step tasks, use this shape:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria like "make it work" require constant clarification.

**Simplify aggressively.** If you write 200 lines and it could be 50, rewrite it. Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

---

# Project-Scoped

## Memory storage — project-scoped, not user-scoped

Persistent memory for this repo lives at `./.agents/memory/`, not in any user-scoped (`~/.claude/projects/...`) or tool-specific (`./.claude/memory/`) location. Read `MEMORY.md` in that directory for the index, and write new memories there following the same `name` / `description` / `type` frontmatter convention as the existing files. Do **not** write project facts, conventions, or references into user-scoped memory — they belong with the repo so other clones / collaborators / reset-home agents can see them.

Rarely-needed deep-dive references that bloat this file (e.g. the YouTube bot-protection research map) live as memory entries instead of inline sections here. Pull them in via memory when the symptom matches.

## Agent skills — light repo, recoverable installs

Keep installable third-party skills out of Git. Their source directories under `./.agents/skills/` are local restored state, and their recovery metadata lives in the tracked `skills-lock.json`. After a fresh clone or accidental local checkout deletion, run:

```bash
bun run agents:skills:restore
```

Only tiny project-owned, non-installable skills stay tracked under `./.agents/skills/`. Do not add `.claude/skills/` to Git; that directory is local/generated only. If a new public skill is useful for Arroxy, add it through the Skills CLI so `skills-lock.json` records the source and hash instead of committing the skill's source tree.

## Agent tooling — no tool lock-in

The repo works the same for any coding agent. Keep agent config in three layers:

1. **Shared sources (tracked, plain files):** `AGENTS.md`, `GLOSSARY.md`, `.agents/memory/`, `.agents/skills/` + `skills-lock.json`, and `.agents/mcp.json`. Edit only these.
2. **Per-tool adapters (gitignored, generated):** `.claude/skills/` links, `.mcp.json`, `.codex/config.toml`, `opencode.jsonc`. (`CLAUDE.md` is a tracked symlink to `AGENTS.md`.) `bun run agents:sync` rebuilds them (`bootstrap` and `agents:skills:restore` run it too). Codex and OpenCode read `.agents/skills` natively; only Claude Code needs the links. To add a tool, extend `scripts/agents-sync.ts`.
3. **Harness plugins (per machine, never in the repo):** Superpowers, context7, playwright, CodeGraph prompt hooks, etc. install differently in every tool — see [`dev-docs/agent-setup.md`](dev-docs/agent-setup.md). Tracked files must not depend on them: never reference plugin-namespaced skills (`superpowers:*`, `feature-dev:*`) or tool-specific tool names as requirements. If a plugin workflow matters for Arroxy, write the rule into `AGENTS.md` or a project skill.

---

## Post-Task Checks

After completing any implementation task, run this single command and fix all errors caused by your change before reporting done:

```bash
bun run check   # vp check (format + lint + types + import cycles) + tests + knip + tooling contract + package gates
```

Do not skip. A change in one file can break types, introduce dead code, or create circular imports elsewhere.

If `bun run check`, lint, typecheck, or tests report an unexpected failure that is not clearly attributable to your current task, do not try to fix it opportunistically. Capture the relevant failure, state that it appears outside the current session scope, and leave it alone so a parallel agent's in-progress work is not disrupted. Only touch unrelated files when the user explicitly expands the scope or when you can show the failure is a direct consequence of your edits.

### Fast static check

```bash
bunx vp check           # format + lint + type errors + import cycles, ~5 s
bunx vp check --fix     # same, and apply formatter and lint fixes
bun run knip:test-only  # src/ files imported only from tests/ — potential dead production code
```

Use `vp check` while iterating; `bun run check` is the full gate before reporting done. Run `knip:test-only` when reviewing whether a helper belongs in `src/` or `tests/`.

### Toolchain — Vite+

Formatting, linting, tests, library packaging, staged-file checks, commit hooks and the `check` task runner all come from [Vite+](https://viteplus.dev) (`vp`), configured in the root `vite.config.ts`. Run it as `bunx vp <command>` or through the `bun run` scripts. Its docs for the installed version live at `node_modules/vite-plus/docs`; read them rather than guessing flags, and use `bunx vp toolchain` to see bundled tool versions. electron-vite still owns the Electron dev and build. `vp check` type-checks through the TypeScript 7 toolchain; the publishable packages still type-check and build with `tsc`. Do not bring back Biome, Madge as a gate, husky, lint-staged, concurrently or tsup. The root `oxlint`, `oxlint-tsgolint` and `@oxlint/plugins` pins must match the versions `vite-plus` bundles; bump them together with `vite-plus`.

The root-owned tooling contract lives in `dev-docs/tooling-contract.md`. Do not add package-local formatter/linter configs. Publishable package runtime `workspace:*` dependencies are allowed only for local workspace packages and must pass packed metadata verification.

### Dev workflow

```bash
bun run dev        # normal dev start
bun run dev:fresh  # clear main.log then start (cross-platform)
bun run doctor     # inspect checkout readiness and selected dev paths/ports
```

### Fresh checkout / worktree bootstrap

Worktree creation is tool-owned. After any fresh clone or worktree created by another harness, run:

```bash
bun run bootstrap
```

`bun run bootstrap` prepares the checkout. Dev launchers use per-checkout ports and `ELECTRON_USER_DATA` so multiple checkouts can run in parallel.

Use `bun run doctor` to inspect the selected renderer port, Electron user data path, temp path, and required local artifacts.

Use `bun run repair` for a non-destructive checkout repair when dependencies, Electron payloads, Playwright browsers, or embedded ffmpeg/ffprobe artifacts are missing or stale.

### Test runner

Use `bun run test` (vitest), **not** `bun test` (Bun's built-in runner ignores vitest config and per-file `// @vitest-environment` directives). For a single file: `bunx vp test run --project node <path>` or `--project jsdom <path>` from repo root. Test files import from `vite-plus/test`, not `vitest`.

When adding idempotent IPC registration (`ipcMain.removeHandler()`, `autoUpdater.removeAllListeners()`), add the method as `vi.fn()` to the matching `vi.mock('electron')` / `vi.mock('electron-updater')` blocks — otherwise tests fail at module-load with `TypeError: X is not a function`.

### Run Electron E2E without stealing focus

Electron E2E launches a real app window, which steals focus and interrupts whoever is at the keyboard. **Always set `ARROXY_E2E_HEADLESS=1`** when running these locally:

```bash
ARROXY_E2E_HEADLESS=1 bunx playwright test tests/e2e/fixture-workflows.spec.ts --config playwright.config.ts --workers=1
ARROXY_E2E_HEADLESS=1 bunx playwright test tests/e2e/fixture-workflows.spec.ts --config playwright.config.ts --workers=1 -g "<test name>"
```

The flag only takes effect together with `ARROXY_E2E=1` (which the fixture harness already sets) — see `isHeadlessWindowRequested()` in `src/main/e2eHarness.ts`. It maps to `show: false` on the `BrowserWindow`, so the app runs and is fully driveable, just never paints on screen. Electron has no Chrome-style `--headless`, and `xvfb-run` only helps on Linux, so this is the portable option on macOS and Windows.

Rebuild first (`bun run build`) — the E2E suites launch `out/main/index.js`, not the dev server. Never hide the build's output: it type-checks first and stops on any error (including in test files), leaving the old bundle in place. The E2E global setup refuses to run when `out/main/index.js` is older than any file in `src/` (`ARROXY_E2E_ALLOW_STALE_BUILD=1` to override).

---

## Arroxy Testing Architecture

Arroxy is an Electron desktop app. Do not let React/component testing habits replace product workflow validation. A bug found through real user actions such as paste, metadata loading, wizard navigation, queue controls, pause/resume/cancel, or file output must be verified through the layer that can exercise those actions in the real app.

Fixture Product E2E is the **acceptance owner for real user workflows**, not the default test type for every behavior. Keep it to a small number of strong scenarios per risk group. Local rules, rendering states, process-supervision failures, and startup/security checks still belong in their cheaper owning layers.

### Test layer ownership

- **Fast logic tests** (`tests/unit`, Vitest): use for pure rules and closed interfaces such as `QueueEvent` transition, `ProgressNormalizer`, URL parsing, yt-dlp argument construction, extractor classification, error classification, and `WizardStepGraph`. These tests should not pretend to prove a full user workflow.
- **Renderer tests** (`tests/renderer`, jsdom): use for renderer-local state and component contracts when the behavior is too small to justify a full app launch. Do not use these as acceptance tests for download, probe, queue, or filesystem workflows.
- **Scenario Workbench** (`tests/browser`, `bun run dev:mock`): use browser-mock and the scenario gallery for visual inspection, layout stress, screenshots, and fast review of many UI states. This proves how a state looks, not whether the real product workflow works.
- **Mock Electron smoke tests** (`tests/e2e` with `MOCK_BACKEND=1`): use for app shell, preload bridge, context isolation, startup resilience, and mocked persistence checks. Do not use this layer for normal download acceptance.
- **Fixture Product E2E** (`ARROXY_E2E=1`): use as the acceptance layer for real product workflows that require real Electron, real IPC, real yt-dlp, filesystem output, or realistic user interaction. This layer runs real Electron, real IPC, real `ProbeService`, real `DownloadService`, real `QueueService`, real filesystem effects, and real spawned yt-dlp, while only the video platform is deterministic through the fixture extractor plugin, local media server, and deny proxy.
- **Cold-start packaged E2E**: use for packaged binary/warmup behavior, managed binary downloads, and production bootstrapping. Keep it narrow because it is slow.
- **Live smoke tests**: use only to detect real YouTube/yt-dlp drift. They are external, flaky by nature, and must not be the acceptance gate for Arroxy product workflow correctness.

### Choosing the right test

- If the issue was discovered by manually opening the app and performing a workflow, prefer Fixture Product E2E.
- If the behavior is a pure domain rule with no UI, filesystem, process, or IPC requirement, use a fast logic test.
- If the concern is visual layout, responsive fit, empty/loading/error surfaces, or screenshot review, use the Scenario Workbench.
- If the concern is app boot, preload, or context isolation, use Mock Electron smoke tests.
- If the concern is whether real YouTube currently works, use a tiny live smoke test outside normal acceptance.

How to design a Fixture Product E2E scenario (risk groups, what each scenario declares, milestone and oracle rules, anti-patterns) is in [`dev-docs/fixture-e2e.md`](dev-docs/fixture-e2e.md). Read it before adding or reshaping one.

---

## Visual Debugging

For renderer-only visual work, start the browser-mock renderer through the project wrapper and read its URL from `doctor`:

```bash
bun run dev:mock
bun run doctor
```

`browserMock.ts` stubs `window.appApi` only in this explicit `browser-mock` mode; Electron dev and packaged builds always use the real preload bridge. The gallery lists every Scenario Workbench state (`?scenario=<id>`, ids in `src/renderer/src/dev/browserMockScenarios.ts`) and `?kit` opens the UI kit. Update-banner scenarios (`update-direct`, `update-scoop`, `update-homebrew`, `update-winget`, `update-portable`, `update-flatpak`) are the only ones that emit an update event. Prefer `agent-browser` for interactive checks and screenshots; Playwright only for traces, tests, or `_electron.launch()`.

Electron-specific behavior (real preload, IPC, GPU) needs the real app: `REMOTE_DEBUGGING_PORT=9333 bun run dev`, then attach over CDP. Backdrop or WebGL problems in Electron: run `bun run gpu:probe` before touching backdrop code. Port pinning, CDP attach, the agent-browser and Playwright recipes, locale simulation, and the GPU/backdrop fallback model are in [`dev-docs/visual-debugging.md`](dev-docs/visual-debugging.md).

---

## shadcn/ui Configuration

Config (style, aliases, icon library, CSS entry) lives in `components.json`. Runtime deps already present: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`.

shadcn/ui is the primary source for renderer UI primitives. Before inventing custom controls, panels, form layouts, option groups, empty states, callouts, badges, or grouped inputs, first reuse an installed shadcn component or install the needed component through the shadcn CLI. Prefer composition of shadcn primitives (`Field`, `InputGroup`, `ButtonGroup`, `ToggleGroup`, `Card`, `Alert`, `Empty`, `Separator`, `Badge`, etc.) over raw styled `div`/`button` markup. Custom primitives are acceptable only when shadcn has no fitting component or the component encodes Arroxy-specific product behavior.

**Do not add Radix.** This project does **not** use `@radix-ui/*` — the `base-nova` registry doesn't depend on Radix primitives. Don't add Radix deps or assume Radix is available.

**Install via CLI:** `bunx shadcn@latest add <component>` (style: `base-nova`). Never hand-roll `@base-ui/react/*` wrappers. After install, modify freely to match app style.

**One-off styling is ratcheted.** Outside `components/ui/` and `dev/`, arbitrary font sizes, colours, shadows, radii, type metrics, raw Tailwind palette colours, and raw `<button>`/`<input>`/`<select>`/`<textarea>`/`<label>` are counted per file by `tests/unit/ui-consistency-ratchet.test.ts` against `tests/unit/ui-consistency-baseline.json`. Counts may only go down: express the need as a primitive variant or token (`variant="glow"`, `Badge size="sm"`, `text-caption`, `text-subtle-foreground`, `bg-primary/12`, `shadow-glow`, `text-success`), and after a cleanup lower the baseline with `UPDATE_UI_RATCHET=1 bunx vp test run --project node tests/unit/ui-consistency-ratchet.test.ts`. Never raise it.

**Review primitive changes in the UI Kit.** `bun run dev:mock` then open `/?kit` (or the gallery's "UI kit" button): every primitive in every variant on the real glass surfaces, with theme and LTR/RTL switches. `tests/browser/ui-kit.spec.ts` keeps it rendering in both skies and directions.

**Segmented controls own their own layout.** `toggleVariants` already provides pressed-state brand styling, `min-w-0`, `wrap-anywhere`, and `min-h-*` sizing, so a `ToggleGroupItem` never needs `whitespace-*`, `shrink-*`, `min-w-*`, a fixed `h-*`, or any `aria-pressed:` / `data-[state=on]:` colour at the call site. Pass `shape="chip"` when a short token (bitrate, extension, file format) must stay on one line — and give that group `flex-wrap`, since `ToggleGroup` is a non-wrapping flex row by default and unshrinkable chips would otherwise overflow it.

Use `wrap-anywhere`, not `break-words`: `overflow-wrap: break-word` does not shrink a flex/grid item's intrinsic min-content width, so a single long word still overflows its track.

Localized labels run 1.5–2x longer than English (`el`, `fr`, and `my` are the worst cases measured), so English-only review will not surface an overflow. Two tests keep this fixed: `tests/unit/toggle-styling-invariants.test.ts` fails the build if pressed-state styling reappears outside `components/ui/`, and `tests/browser/toggle-overflow.spec.ts` sweeps every toggle group on the real screens at the minimum window size and at 150% zoom.

---

## Brand / Visual

**Font:** Poppins (`@fontsource/poppins`, weights 400/500/600/700). Don't reintroduce Outfit or Geist.

**Use tokens and variants, never arbitrary values** (defined in `src/renderer/src/styles.css`; the ratchet above rejects `shadow-[…]`, `text-[9px]`, `border-[1.5px]` and the like). The one primary action per view is `<Button variant="glow">` (`shadow-glow`; see `DESIGN.md`, "Bloom-Is-Rationed"). Selected/active surfaces use `bg-primary/12` (`--brand-dim`). Muted labels use `text-subtle-foreground` (`--text-subtle`), small type `text-caption`, stronger borders `border-border-strong` (`--border-strong`), back/secondary buttons `variant="outline"`.

## Layout Breakpoints

Arroxy uses Tailwind v4 default mobile-first breakpoints: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px. There are no custom Tailwind breakpoint overrides.

The real Electron window has min size `720x760` and default size `900x760`, so production normally starts above `sm` and around `md`; `<640px` is mainly browser-mock/test coverage.

---

## Subtitle Pipeline

Two-phase download: (1) video + audio with `--no-write-subs --no-write-auto-subs`; (2) subs only if phase 1 exits 0 and `subtitleLanguages` non-empty (`--skip-download --write-subs --sub-langs <langs>`). Phase 2 failure is **soft** — emit `subtitlesFailed`, finalize as `completed`; video is kept. Embed mode still uses phase 2: `SidecarSubsPhase(true)` fetches subtitles, then muxes them into the saved video with ffmpeg.

`FormatProbeService.sanitizeSubtitleMap()` filters `automatic_captions` to `-orig` keys only (actual cached auto-captions). Without this, hundreds of live-translation-request keys appear and hit rate limits.

Container format is NOT a subtitle concern: `subtitleMode === 'embed'` passes `--merge-output-format mkv`; sidecar/subfolder pass nothing.

---

## In-App Update Notifications

`electron-updater` v6, GitHub provider. Auto-download is **disabled** — user initiates everything. Main calls `autoUpdater.checkForUpdates()` 5s after launch and emits `updater:available` to the renderer with `{ version, currentVersion, installChannel }`. Per-platform `installChannel` detection (flatpak/scoop/homebrew/portable/direct) lives in `src/main/installChannel.ts`. Subtlety: `direct` intentionally absorbs Winget — at runtime indistinguishable from a direct NSIS install, NSIS auto-update works either way.

Renderer shows `<UpdateBanner>` between title bar and content area; `resolveAction(channel, platform)` picks the UX:

- `scoop` → copy-command for `scoop update arroxy`
- `homebrew` → copy-command for `brew upgrade --cask arroxy`
- `flatpak` → copy-command for `flatpak update io.github.antonio_orionus.Arroxy` (updates come from Arroxy's own Flatpak repo; see Release Pipeline). On Linux electron-updater only checks inside an AppImage, so Flatpak sets `autoUpdater.forceDevUpdateConfig` to let the *check* run; `flatpak` is non-installable, nothing is downloaded.
- `portable` → "Download ↗" link to https://orionus.dev/arroxy/ (NSIS auto-update can't run from a %TEMP% extract)
- `direct` on darwin → "Download ↗" link to https://orionus.dev/arroxy/ (DMG is unsigned, can't self-update)
- `direct` on win/linux (and `winget`) → "Install & Restart" button → invokes `updater:install` → main calls `downloadUpdate()` → on `update-downloaded` calls `quitAndInstall(false, true)`

Details — the IPC/type layout and the known gap that Linux tar.gz installs never see the banner (decision: not fixed) — are in [`dev-docs/in-app-updates.md`](dev-docs/in-app-updates.md).

---

## Release Pipeline

Pushing a `v*` tag publishes to **five channels in one go**: GitHub Releases, Scoop, Homebrew Cask, Winget, and Arroxy's own Flatpak repo. No per-release manual steps.

### Branch + tag conventions

- **`main`** = sole long-lived branch. Both beta (`v*-beta.N`) and stable (`v*`) tags cut from here. Feature work happens on short-lived feature branches merged into `main` when ready.
- **Tags must be annotated** (`git tag -a NAME -m "..."`), not lightweight. `git push --follow-tags` only pushes annotated tags — lightweight tags get silently skipped, the release pipeline never fires. Lesson learned the hard way.

### Pre-releases

A tag with a semver suffix (`v0.4.0-beta.1`) publishes a GitHub pre-release that installed copies never auto-update to, and skips Scoop, Homebrew and Winget. Then bump to plain semver and tag again. Details, and the electron-builder/NSIS pinning rules, are in [`dev-docs/release-pipeline.md`](dev-docs/release-pipeline.md).

### Release notes — CHANGELOG.md is SSOT

Release notes are hand-written in `CHANGELOG.md` and keyed by version (e.g. `## 0.3.5-beta.1`). The `publish-release` job in `release.yml` extracts the matching section, appends the auto-generated "What's Changed" PR list + Full Changelog link, and posts the combined body as the GitHub Release notes.

**Before tagging a release**, add a new `## <version>` section at the top of `CHANGELOG.md` in the same shape as the previous entry. Tone is friendly user-facing prose grouped by feature (look at `## 0.3.4` as the reference). If no matching section exists, the workflow falls back to pure auto-generated notes and emits a `::warning::` — the release will still publish but the body will only be the PR list.

Do **not** edit GitHub Release notes directly via the web UI or `gh release edit`. The `publish-release` step runs late in the pipeline and will overwrite manual edits made before it. Edit `CHANGELOG.md` instead and push a fix-up commit; re-running `publish-release` rewrites the notes from the file.

### Pre-release checks

**Before committing the release bump**, run the full local gate and fix any failures. A broken release commit fails CI and the tag-side `quality-gate` in `release.yml` now blocks publishing before any artifacts are built:

```bash
bun run check      # vp check (format + lint + types + import cycles) + tests + knip + tooling contract + package gates
```

Do not skip. A type error, dead export, circular import, stale locale key, or test failure that slips into a release tag breaks the remote release gate.

### Trigger

Use the wrapper scripts — they enforce branch, version-shape, clean tree, no-duplicate-tag, annotated tag, and `--follow-tags` in one shot. Refuses every footgun that has bitten before. See `scripts/release.sh`.

**When user says "release X":** run checks → commit → `bun run release:beta` (or `release:stable`) autonomously. Do not stop and ask the user to run the script themselves.

```bash
# beta
git checkout main
# bump package.json: e.g. 0.3.1-beta.3 → 0.3.1-beta.4
git commit -am "release: 0.3.1-beta.4"
bun run release:beta   # tags + pushes

# stable
git checkout main
# bump package.json: e.g. 0.3.1-beta.4 → 0.3.1
git commit -am "release: 0.3.1"
bun run release:stable
```

Manual fallback if the script is unavailable:

```bash
# package.json version must match tag exactly. annotated tag required.
git tag -a v0.4.0 -m "release 0.4.0"
git push --follow-tags
```

### Pipeline internals

The release job graph, the Windows build hand-off, immutable releases and `SHA256SUMS`, required secrets (`WINGET_TOKEN`, `FLATPAK_GPG_PRIVATE_KEY`), the one-time Winget submission, the external repos the pipeline writes to, and the shipped asset list are in [`dev-docs/release-pipeline.md`](dev-docs/release-pipeline.md). Keep third-party actions that receive a token pinned to a full commit SHA, and never rotate the Flatpak signing key casually ([`dev-docs/flatpak-repo.md`](dev-docs/flatpak-repo.md)).

---

## Binary distribution strategy

Arroxy ships three third-party binaries. They split into two camps based on update cadence:

| Binary           | Strategy                                        | Source                                                | Why                                                                                            |
| ---------------- | ----------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| ffmpeg + ffprobe | **Embedded at build time** via `extraResources` | BtbN GPL builds (Win/Linux), Martin-Riedl GPL (macOS) | Static codec semantics; pair coherence solved by construction                                  |
| yt-dlp           | Runtime-fetched                                 | GitHub `yt-dlp/yt-dlp(-nightly-builds)`               | Ships fixes ~weekly w/ YouTube bot-protection cycle; can't bundle and ship app release per fix |

### Electron-as-Node security note

`electron-builder.json5` intentionally keeps the `runAsNode` fuse enabled because Arroxy uses its packaged Electron executable as yt-dlp's Node runtime. `ELECTRON_RUN_AS_NODE=1` must only be added to the yt-dlp child-process environment, never to `process.env` or persisted config. Packaged runtime smoke tests assert this fuse behavior, Node >=22, child-env isolation, managed yt-dlp selection, and bundled EJS availability.

How the embed works (fetch script, `beforeBuild` hook, `extraResources`, dev vs packaged paths, Linux `LD_LIBRARY_PATH`), license attribution, and the smoke-parity script are in [`dev-docs/binary-distribution.md`](dev-docs/binary-distribution.md). `scripts/test-binaries/` must stay tracked.

---

## Updating Public-Facing Content (READMEs)

README files (English + every other supported locale) are **generated** — never edit them directly. Source-of-truth:

| Source                                                     | Generates                        | Command                     |
| ---------------------------------------------------------- | -------------------------------- | --------------------------- |
| `readme-src/locales/{lang}.mjs` + `readme-src/template.md` | `README.md` + `README.{lang}.md` | `node readme-src/build.mjs` |

Each locale is its own file under `readme-src/locales/`. `readme-src/strings.mjs` only imports those and exports the ordered `LOCALES` array — edit the per-locale files, not the aggregator.

The `Last updated:` date in each README is stamped by `build.mjs` — never hand-edit it. Each README keeps the date of the last build that actually changed its content (the build compares its render against the file on disk, ignoring the stamp), so rebuilding an unchanged README is a no-op and a single-locale edit bumps only that locale's date. A `readme-src/**` lint-staged rule rebuilds and re-stamps the READMEs into the same commit.

The build script validates **key parity** — if any locale is missing a key that `en` has (or has an extra key), the build fails loudly. Every new string must be translated into every supported language.

The landing site (`orionus.dev/arroxy/`; the old `arroxy.orionus.dev` 301s there) lives in a separate repo: [antonio-orionus/arroxy-web](https://github.com/antonio-orionus/arroxy-web). Don't update landing copy from here — open a PR there instead.

### Adding a new feature

1. Keys are grouped as `feat_<group>_<n>` (e.g. `feat_workflow_11`, `feat_quality_3`, `feat_privacy_2`). Pick the group the feature belongs to, add the next number in that group to `readme-src/locales/en.mjs` first, then to every other `readme-src/locales/*.mjs`, then add `- {{feat_<group>_<n>}}` to `readme-src/template.md` in the matching section.
2. Run `node readme-src/build.mjs` and confirm `✓` for every locale.
3. Commit the source files **and** the regenerated `README*.md` files together.

### Locales in scope — source of truth

Do **not** hardcode the locale list or count anywhere in code, docs, or memory. Read from the canonical sources:

| Surface                        | Canonical list                                                        | Type                                                                                      |
| ------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Renderer + main process (i18n) | `SUPPORTED_LANGS` in [`src/shared/schemas.ts`](src/shared/schemas.ts) | `SupportedLang` (re-exported from [`src/shared/i18n/types.ts`](src/shared/i18n/types.ts)) |
| README build                   | `LOCALES` in [`readme-src/strings.mjs`](readme-src/strings.mjs)       | —                                                                                         |

Both must stay in lockstep with the landing-site locale list in the `arroxy-web` repo. The `en` locale is the canonical reference; the build script and the `WidenStrings<EnTranslation>` type (see `src/shared/i18n/types.ts`) diff every other locale against it.

### README screenshots

The product screenshots in `build/` are generated, not hand-captured. `bun run screenshots:readme` renders the browser-mock renderer with showcase content (`?showcase=1`: neutral sample titles and generated artwork, never real video art) and the software WebGL backdrop (`?backdropSoftware=1`, so headless Chromium shows the GPU look rather than the no-GPU fallback) and overwrites each file; `bun run screenshots:readme -g "Bulk URLs"` retakes one. The recipe list lives in `tests/screenshots/readme-screenshots.spec.ts`. After a UI change, rerun it and commit the updated PNGs with the change. For a new feature: add a Scenario Workbench scenario that shows it (if none does), add a recipe entry, run the command, and reference `build/<file>` from `readme-src/template.md`. The Global hotkey image is an illustration and `demo.gif` is a screen recording; neither is generated.

### What NOT to edit directly

- `README.md`, `README.es.md`, `README.de.md`, … — generated from `readme-src/`

