import {describe, expect, it, vi} from 'vite-plus/test'
import type {AndroidNativePort, Launch, YtDlpRun} from '../../src/android/nativePort.js'
import {createAndroidAppApi} from '../../src/android/createAndroidAppApi.js'
import type {KeyValueStore} from '../../src/android/storage.js'
import {createShellStore, type ShellStore} from '../../src/android/ui/store.js'
import {quietNative} from '../helpers/androidNative.js'

const VIDEO_JSON = JSON.stringify({id: 'abc', title: 'Shared video', extractor: 'youtube', extractor_key: 'Youtube', webpage_url: 'https://www.youtube.com/watch?v=abc', formats: [{format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360}]})

function memoryStore(): KeyValueStore {
	const entries = new Map<string, string>()
	return {get: key => entries.get(key) ?? null, set: (key, value) => void entries.set(key, value)}
}

// A native side that answers probes, holds downloads open, and hands out one launch.
function phone(launch: Launch | null, overrides: Partial<AndroidNativePort> = {}): AndroidNativePort {
	let pending = launch
	return quietNative({
		runYtDlp: (_runId, args) => (args.includes('--dump-single-json') ? Promise.resolve<YtDlpRun>({exitCode: 0, stdout: VIDEO_JSON, stderr: '', cancelled: false}) : new Promise<YtDlpRun>(() => undefined)),
		takeLaunch: () => {
			const next = pending
			pending = null
			return Promise.resolve(next)
		},
		...overrides
	})
}

function makeStore(native: AndroidNativePort, clipboardSeenAt = {value: -1}): ShellStore {
	const api = createAndroidAppApi({native, store: memoryStore(), publicDir: 'Download/Arroxy'})
	let n = 0
	return createShellStore(api, {native, checkForUpdate: () => Promise.resolve(null), clipboardSeenAt: {get: () => clipboardSeenAt.value, set: value => void (clipboardSeenAt.value = value)}}, () => `id-${++n}`)
}

describe('Android UI: ways into the app', () => {
	it('opens a shared link straight into its result', async () => {
		const store = makeStore(phone({kind: 'share', text: 'Look: https://youtu.be/abc?si=TRACKING', quick: false}))
		await store.getState().start()
		const state = store.getState()
		expect(state.boot.kind).toBe('ready')
		expect(state.home.kind === 'video' ? state.home.probe.title : null).toBe('Shared video')
		expect(state.draftUrl).toBe('https://youtu.be/abc')
	})

	it('"Download now" queues with the active quality, confirms in a notification and goes back', async () => {
		const showResult = vi.fn(() => Promise.resolve())
		const moveToBackground = vi.fn(() => Promise.resolve())
		const store = makeStore(phone({kind: 'share', text: 'https://youtu.be/abc', quick: true}, {showResult, moveToBackground}))
		await store.getState().start()
		await vi.waitFor(() => expect(store.getState().items).toHaveLength(1))
		expect(showResult).toHaveBeenCalledWith(expect.objectContaining({title: expect.stringContaining('Shared video')}))
		expect(moveToBackground).toHaveBeenCalled()
		expect(store.getState().home.kind).toBe('idle')
	})

	it('the "Paste link" shortcut looks up what is on the clipboard', async () => {
		const store = makeStore(phone({kind: 'paste'}, {readClipboard: () => Promise.resolve({text: 'https://youtu.be/abc', copiedAt: 5})}))
		await store.getState().start()
		expect(store.getState().home.kind).toBe('video')
	})

	it('the "Downloads" shortcut opens the Downloads tab', async () => {
		const store = makeStore(phone({kind: 'downloads'}))
		await store.getState().start()
		expect(store.getState().tab).toBe('downloads')
	})
})

describe('Android UI: clipboard watch', () => {
	it('offers a newly copied link once, and only reads clips newer than the last one seen', async () => {
		const readClipboard = vi.fn((since: number) => Promise.resolve(since >= 7 ? {text: null, copiedAt: 7} : {text: 'https://youtu.be/abc', copiedAt: 7}))
		const store = makeStore(phone(null, {readClipboard}))
		await store.getState().start()
		expect(store.getState().clipboardLink).toBe('https://youtu.be/abc')
		store.getState().dismissClipboardLink()
		await store.getState().checkClipboard()
		expect(readClipboard).toHaveBeenLastCalledWith(7)
		expect(store.getState().clipboardLink).toBeNull()
	})

	it('stays off when the setting is off', async () => {
		const readClipboard = vi.fn(() => Promise.resolve({text: 'https://youtu.be/abc', copiedAt: 7}))
		const store = makeStore(phone(null, {readClipboard}))
		await store.getState().start()
		store.getState().dismissClipboardLink()
		readClipboard.mockClear()
		await store.getState().updateCommon({clipboardWatchEnabled: false})
		await store.getState().checkClipboard()
		expect(readClipboard).not.toHaveBeenCalled()
	})
})

describe('Android UI: downloads and settings', () => {
	it('queues the result with the chosen quality, asks for notifications once, and empties home', async () => {
		const requestNotifications = vi.fn(() => Promise.resolve(true))
		const store = makeStore(phone({kind: 'share', text: 'https://youtu.be/abc', quick: false}, {requestNotifications}))
		await store.getState().start()
		await store.getState().setQuality('audio')
		await store.getState().downloadCurrent()
		await vi.waitFor(() => expect(store.getState().items).toHaveLength(1))
		expect(store.getState().items[0]?.formatLabel).toBe('Audio only')
		expect(store.getState().home.kind).toBe('idle')
		expect(store.getState().toast?.action?.tab).toBe('downloads')
		await store.getState().lookUp('https://youtu.be/other')
		await store.getState().downloadCurrent()
		expect(requestNotifications).toHaveBeenCalledTimes(1)
	})

	it('turns a picked cookies file into desktop-style file mode, and back off', async () => {
		const removeCookiesFile = vi.fn(() => Promise.resolve())
		const store = makeStore(phone(null, {pickCookiesFile: () => Promise.resolve('/data/work/cookies.txt'), removeCookiesFile}))
		await store.getState().start()
		await store.getState().chooseCookies()
		expect(store.getState().settings?.common).toMatchObject({cookiesMode: 'file', cookiesPath: '/data/work/cookies.txt'})
		await store.getState().clearCookies()
		expect(store.getState().settings?.common.cookiesMode).toBe('off')
		expect(removeCookiesFile).toHaveBeenCalled()
	})

	it('walks back out of a result, then out of a secondary tab', async () => {
		const store = makeStore(phone({kind: 'share', text: 'https://youtu.be/abc', quick: false}))
		await store.getState().start()
		store.getState().setTab('settings')
		expect(store.getState().back()).toBe(true)
		expect(store.getState().tab).toBe('home')
		expect(store.getState().back()).toBe(true)
		expect(store.getState().home.kind).toBe('idle')
		expect(store.getState().back()).toBe(false)
	})
})
