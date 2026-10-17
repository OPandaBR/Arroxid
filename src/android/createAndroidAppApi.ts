// The AppApi the renderer talks to on Android. Same contract the Electron
// preload exposes, so the renderer runs unchanged: queue and probe are real
// (backed by the native yt-dlp shell); desktop-only surfaces (window
// controls, global hotkey, tray, Explore browser, in-app updater) answer as
// "not available here" without failing the UI.

import type {AppApi} from '@shared/api.js'
import {defaultAppSettings} from '@shared/constants.js'
import {fail, ok, type Result} from '@shared/result.js'
import type {DependencyDiagnostic, DependencyId, ExploreViewState, QueueItem, QueueSchedulerEventPayload, QueueSnapshotPayload, WarmUpOutput} from '@shared/types.js'
import type {AndroidNativePort, NativeInfo} from './nativePort.js'
import {probeOnAndroid} from './probe.js'
import {AndroidQueue} from './queue.js'
import {AndroidSettingsStore, createQueuePersistence, type KeyValueStore} from './storage.js'

export interface AndroidAppApiDeps {
	native: AndroidNativePort
	store: KeyValueStore
	// Label of the public folder shown to the user before the native side reports it.
	publicDir: string
	now?: () => string
	newId?: () => string
}

function listenerSet<T>(): {add: (listener: (event: T) => void) => () => void; emit: (event: T) => void} {
	const listeners = new Set<(event: T) => void>()
	return {
		add: listener => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		emit: event => listeners.forEach(listener => listener(event))
	}
}

const unavailable = (what: string): Result<never> => fail({code: 'validation', message: `${what} is not available on Android`})
const noop = (): (() => void) => () => undefined

const EXPLORE_OFF: ExploreViewState = {url: '', title: '', canGoBack: false, canGoForward: false, loading: false, signedIn: false, error: null, adBlock: 'off'}

function bundledDependencies(info: NativeInfo): Record<DependencyId, DependencyDiagnostic> {
	const bundled = (id: DependencyId, path: string): DependencyDiagnostic => ({id, state: 'runnable', source: {kind: 'bundled', path}, resolvedPath: path, attempts: [], ...(id === 'yt-dlp' && info.ytDlpVersion ? {versionOutput: info.ytDlpVersion} : {})})
	return {'yt-dlp': bundled('yt-dlp', `${info.workDir}/yt-dlp`), ffmpeg: bundled('ffmpeg', 'libffmpeg.so'), ffprobe: bundled('ffprobe', 'libffmpeg.so')}
}

export function createAndroidAppApi(deps: AndroidAppApiDeps): AppApi {
	const {native} = deps
	const now = deps.now ?? (() => new Date().toISOString())
	const newId = deps.newId ?? (() => crypto.randomUUID())
	const settings = new AndroidSettingsStore(deps.store, {...defaultAppSettings(deps.publicDir), common: {...defaultAppSettings(deps.publicDir).common, exploreEnabled: false, hotkeyEnabled: false, clipboardWatchEnabled: false, analyticsEnabled: false}})

	let nativeInfo: Promise<NativeInfo> | null = null
	const prepare = (): Promise<NativeInfo> => {
		nativeInfo ??= native.prepare().catch((error: unknown) => {
			nativeInfo = null
			throw error
		})
		return nativeInfo
	}

	const added = listenerSet<{items: QueueItem[]; atIdx: number}>()
	const updated = listenerSet<{item: QueueItem}>()
	const removed = listenerSet<{itemId: string}>()
	const scheduler = listenerSet<QueueSchedulerEventPayload>()
	const snapshot = listenerSet<QueueSnapshotPayload>()

	const queue = new AndroidQueue({
		native,
		persistence: createQueuePersistence(deps.store),
		listeners: {added: (items, atIdx) => added.emit({items, atIdx}), updated: item => updated.emit({item}), removed: itemId => removed.emit({itemId}), scheduler: paused => scheduler.emit({paused})},
		common: () => settings.get().common,
		workDir: async () => (await prepare()).workDir,
		now,
		newId
	})

	// Unkeyed (wizard) probes, cancelled together by probeCancel().
	const wizardProbes = new Set<string>()

	return {
		app: {
			warmUp: async () => {
				try {
					let info = await prepare()
					// A failed update keeps the bundled yt-dlp: downloads still work.
					const update = await native.updateYtDlp().catch(() => null)
					if (update?.updated) info = {...info, ytDlpVersion: update.ytDlpVersion}
					queue.kick()
					const output: WarmUpOutput = {completed: true, dependencies: bundledDependencies(info), blockingFailures: [], cancelled: false}
					return ok(output)
				} catch (error) {
					return fail({code: 'binary', message: error instanceof Error ? error.message : String(error)})
				}
			},
			cancelWarmup: () => Promise.resolve(),
			getGraphicsPolicy: () => Promise.resolve(ok({backdrop: {forceRenderMode: 'css-only', softwareWebglAllowed: false}})),
			installYtDlpWithHomebrew: () => Promise.resolve(unavailable('Homebrew')),
			installYtDlpWithWinget: () => Promise.resolve(unavailable('Winget')),
			setLanguage: () => Promise.resolve()
		},
		window: {minimize: () => Promise.resolve(), maximize: () => Promise.resolve(), close: () => Promise.resolve(), isMaximized: () => Promise.resolve(true), onMaximizedChange: noop},
		downloads: {
			probe: async input => {
				await prepare()
				const runId = input.ownerKey !== undefined ? `probe:${input.ownerKey}` : `probe:${newId()}`
				if (input.ownerKey === undefined) wizardProbes.add(runId)
				try {
					return await probeOnAndroid(native, runId, input, settings.get().common)
				} finally {
					wizardProbes.delete(runId)
				}
			},
			probeCancel: async () => {
				await Promise.all([...wizardProbes].map(runId => native.cancelRun(runId)))
			},
			start: () => Promise.resolve(unavailable('Direct download')),
			cancel: () => Promise.resolve(ok({cancelled: false})),
			pause: () => Promise.resolve(ok({paused: false})),
			resume: () => Promise.resolve(ok({resumed: false}))
		},
		settings: {get: () => Promise.resolve(ok(settings.get())), update: patch => Promise.resolve(settings.update(patch))},
		hotkey: {reportOutcome: () => Promise.resolve(ok(undefined)), getState: () => Promise.resolve(ok({accelerator: null, registered: false})), testPress: () => Promise.resolve(unavailable('The global hotkey')), rendererReady: () => Promise.resolve(ok(undefined))},
		shell: {
			openFolder: async () => {
				await native.openDownloads()
				return ok({opened: true})
			},
			openExternal: async url => {
				await native.openExternal(url)
				return ok({opened: true})
			},
			openBinariesDir: () => Promise.resolve(ok({opened: false}))
		},
		logs: {openDir: () => Promise.resolve(ok({opened: false})), uploadFeedbackDiagnostic: () => Promise.resolve(unavailable('Diagnostic upload')), saveDiagnostics: () => Promise.resolve(unavailable('Saving diagnostics'))},
		dialog: {
			// Every Android download lands in the one public folder.
			chooseFolder: () => Promise.resolve(ok({path: settings.get().common.defaultOutputDir})),
			chooseFile: () => Promise.resolve(ok({path: null})),
			chooseExecutable: () => Promise.resolve(ok({path: null}))
		},
		events: {onStatus: noop, onProgress: noop, onProbeProgress: noop, onClipboardUrl: noop, onHotkeyTrigger: noop, onHotkeyOutcome: noop, onWarmupProgress: noop},
		queue: {
			cmd: {
				add: items => Promise.resolve(queue.add(items)),
				getSnapshot: () => Promise.resolve(ok(queue.snapshot())),
				probeFailed: ({itemId, error}) => Promise.resolve(queue.probeFailed(itemId, error)),
				needsChoice: ({itemId, choice, title}) => Promise.resolve(queue.needsChoice(itemId, choice, title)),
				reprobe: ({itemId}) => Promise.resolve(queue.reprobe(itemId)),
				start: ({itemId}) => Promise.resolve(queue.start(itemId)),
				pause: ({itemId}) => Promise.resolve(queue.pause(itemId)),
				resume: ({itemId}) => Promise.resolve(queue.resume(itemId)),
				cancel: ({itemId}) => Promise.resolve(queue.cancel(itemId)),
				retry: ({itemId}) => Promise.resolve(queue.retry(itemId)),
				clearCompleted: () => Promise.resolve(queue.clearCompleted()),
				remove: ({itemId}) => Promise.resolve(queue.remove(itemId)),
				replaceProbing: ({itemId, items}) => Promise.resolve(queue.replaceProbing(itemId, items)),
				setLane: ({itemId, lane}) => Promise.resolve(queue.setLane(itemId, lane)),
				applySelectionAction: ({action, itemIds}) => Promise.resolve(queue.applySelectionAction(action, itemIds)),
				changeOutputTarget: ({itemIds, outputDir}) => Promise.resolve(queue.changeOutputTarget(itemIds, outputDir)),
				pauseAll: () => Promise.resolve(queue.pauseAll()),
				resumeAll: () => Promise.resolve(queue.resumeAll())
			},
			events: {onSnapshot: snapshot.add, onAdded: added.add, onUpdated: updated.add, onRemoved: removed.add, onScheduler: scheduler.add}
		},
		explore: {
			navigate: () => Promise.resolve(unavailable('Explore')),
			setBounds: () => Promise.resolve(ok(undefined)),
			setVisible: () => Promise.resolve(ok(undefined)),
			setActive: () => Promise.resolve(ok(undefined)),
			signOut: () => Promise.resolve(ok(undefined)),
			getState: () => Promise.resolve(ok(EXPLORE_OFF)),
			capture: () => Promise.resolve(ok(null)),
			onStateChanged: noop,
			onPointerInView: noop
		},
		updater: {onUpdateAvailable: noop, install: () => Promise.resolve({ok: false, error: 'In-app updates are not available on Android'})},
		diagnostics: {logWizardStep: () => undefined},
		playlist: {scanFolder: () => Promise.resolve(ok({matchedIds: []})), registerManifest: () => Promise.resolve(ok(undefined))}
	}
}
