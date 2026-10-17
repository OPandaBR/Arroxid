import {describe, expect, it, vi} from 'vite-plus/test'
import type {AndroidNativePort, YtDlpRun} from '../../src/android/nativePort.js'
import {createAndroidAppApi} from '../../src/android/createAndroidAppApi.js'
import type {KeyValueStore} from '../../src/android/storage.js'
import {createShellStore} from '../../src/android/ui/store.js'

const VIDEO_JSON = JSON.stringify({id: 'abc', title: 'Shared video', extractor: 'youtube', extractor_key: 'Youtube', webpage_url: 'https://www.youtube.com/watch?v=abc', formats: [{format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360}]})

// A native side that answers probes and holds downloads open.
function fakeNative(sharedText: string | null): AndroidNativePort {
	let share = sharedText
	return {
		prepare: () => Promise.resolve({workDir: '/w', publicDir: 'Download/Arroxy', ytDlpVersion: '2026.10.01'}),
		updateYtDlp: () => Promise.resolve({updated: false, ytDlpVersion: '2026.10.01'}),
		runYtDlp: (_runId, args) => (args.includes('--dump-single-json') ? Promise.resolve<YtDlpRun>({exitCode: 0, stdout: VIDEO_JSON, stderr: '', cancelled: false}) : new Promise<YtDlpRun>(() => undefined)),
		cancelRun: () => Promise.resolve(),
		publish: () => Promise.resolve([]),
		removeDir: () => Promise.resolve(),
		openDownloads: () => Promise.resolve(),
		openFile: () => Promise.resolve(),
		openExternal: () => Promise.resolve(),
		takeSharedText: () => {
			const text = share
			share = null
			return Promise.resolve(text)
		},
		onShareArrived: () => () => undefined
	}
}

function memoryStore(): KeyValueStore {
	const entries = new Map<string, string>()
	return {get: key => entries.get(key) ?? null, set: (key, value) => void entries.set(key, value)}
}

function makeStore(sharedText: string | null): ReturnType<typeof createShellStore> {
	const native = fakeNative(sharedText)
	const api = createAndroidAppApi({native, store: memoryStore(), publicDir: 'Download/Arroxy'})
	let n = 0
	return createShellStore(api, {takeSharedText: () => native.takeSharedText(), onShareArrived: () => () => undefined, openFile: () => Promise.resolve(), setDarkSystemBars: () => undefined}, () => `id-${++n}`)
}

describe('Android UI state', () => {
	it('opens a link shared from another app straight into its result', async () => {
		const store = makeStore('Look: https://youtu.be/abc?si=TRACKING')
		await store.getState().start()
		const state = store.getState()
		expect(state.boot.kind).toBe('ready')
		expect(state.home.kind === 'video' ? state.home.probe.title : null).toBe('Shared video')
		expect(state.draftUrl).toBe('https://youtu.be/abc')
	})

	it('queues the result with the chosen quality and goes back to an empty home', async () => {
		const store = makeStore('https://youtu.be/abc')
		await store.getState().start()
		await store.getState().setQuality('audio')
		await store.getState().downloadCurrent()
		await vi.waitFor(() => expect(store.getState().items).toHaveLength(1))
		expect(store.getState().items[0]?.formatLabel).toBe('Audio only')
		expect(store.getState().home.kind).toBe('idle')
		expect(store.getState().toast?.action?.tab).toBe('downloads')
	})

	it('walks back out of a result, then out of a secondary tab', async () => {
		const store = makeStore('https://youtu.be/abc')
		await store.getState().start()
		store.getState().setTab('settings')
		expect(store.getState().back()).toBe(true)
		expect(store.getState().tab).toBe('home')
		expect(store.getState().back()).toBe(true)
		expect(store.getState().home.kind).toBe('idle')
		expect(store.getState().back()).toBe(false)
	})
})
