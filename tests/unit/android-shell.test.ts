import {describe, expect, it, vi} from 'vite-plus/test'
import {defaultAppSettings} from '@shared/constants.js'
import type {QueueItem, QueueSnapshotPayload} from '@shared/types.js'
import type {AndroidNativePort, YtDlpRun} from '../../src/android/nativePort.js'
import {probeOnAndroid} from '../../src/android/probe.js'
import {AndroidQueue, type QueuePersistence} from '../../src/android/queue.js'
import {AndroidSettingsStore, createQueuePersistence, type KeyValueStore} from '../../src/android/storage.js'
import {mediaArgs, probeArgs} from '../../src/android/ytDlpArgs.js'
import {makeItem} from '../shared/fixtures.js'

const COMMON = defaultAppSettings('Download/Arroxy').common
const OK_RUN: YtDlpRun = {exitCode: 0, stdout: '', stderr: '', cancelled: false}

interface PendingRun {
	runId: string
	args: readonly string[]
	onLine: (line: string) => void
	finish: (run: YtDlpRun) => void
}

// A native shell whose yt-dlp runs stay open until the test finishes them.
function fakeNative(): {native: AndroidNativePort; runs: PendingRun[]; removed: string[]} {
	const runs: PendingRun[] = []
	const removed: string[] = []
	const native: AndroidNativePort = {
		prepare: () => Promise.resolve({workDir: '/data/work', publicDir: 'Download/Arroxy', ytDlpVersion: '2026.10.01'}),
		updateYtDlp: () => Promise.resolve({updated: false, ytDlpVersion: '2026.10.01'}),
		runYtDlp: (runId, args, onLine) => new Promise(resolve => runs.push({runId, args, onLine: onLine ?? (() => undefined), finish: resolve})),
		cancelRun: runId => {
			const run = runs.find(entry => entry.runId === runId)
			run?.finish({exitCode: 1, stdout: '', stderr: '', cancelled: true})
			return Promise.resolve()
		},
		publish: () => Promise.resolve([{name: 'Video [abc].mp4', relativePath: 'Download/Arroxy/Video [abc].mp4', sizeBytes: 1024}]),
		removeDir: dir => {
			removed.push(dir)
			return Promise.resolve()
		},
		openDownloads: () => Promise.resolve(),
		openExternal: () => Promise.resolve()
	}
	return {native, runs, removed}
}

function memoryPersistence(initial: QueueSnapshotPayload = {items: [], schedulerPaused: false}): QueuePersistence & {saved: QueueSnapshotPayload} {
	const state = {saved: initial}
	return {
		get saved() {
			return state.saved
		},
		load: () => state.saved,
		save: snapshot => {
			state.saved = snapshot
		}
	}
}

function makeQueue(native: AndroidNativePort, persistence = memoryPersistence()): {queue: AndroidQueue; updates: QueueItem[]} {
	const updates: QueueItem[] = []
	let id = 0
	const queue = new AndroidQueue({native, persistence, listeners: {added: () => undefined, updated: item => updates.push(item), removed: () => undefined, scheduler: () => undefined}, common: () => COMMON, workDir: () => Promise.resolve('/data/work'), now: () => '2026-10-17T00:00:00.000Z', newId: () => `run-${++id}`})
	return {queue, updates}
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

function statusOf(queue: AndroidQueue, id: string): string | undefined {
	return queue.snapshot().items.find(item => item.id === id)?.status
}

describe('Android yt-dlp argv', () => {
	it('plans a probe the way desktop does, with the shell extras first', () => {
		const args = probeArgs({url: 'https://www.youtube.com/watch?v=abc', playlistMode: 'video'}, {...COMMON, proxyUrl: 'socks5://127.0.0.1:9050'})
		expect(args.slice(0, 4)).toEqual(['--encoding', 'utf-8', '--proxy', 'socks5://127.0.0.1:9050'])
		expect(args).toContain('--dump-single-json')
		expect(args).toContain('--no-playlist')
		expect(args.at(-1)).toBe('https://www.youtube.com/watch?v=abc')
	})

	it('writes media into the job directory and caps the rate only for media', () => {
		const item = makeItem({id: 'abc', status: 'pending'})
		if (item.job.kind === 'unresolved' || item.job.kind === 'subtitle-only') throw new Error('fixture must carry a media job')
		const args = mediaArgs({url: item.url, job: item.job, outputDir: '/data/work/jobs/abc'}, {...COMMON, limitRate: '2M'})
		expect(args).toEqual(expect.arrayContaining(['--limit-rate', '2M', '-f', '137+251']))
		expect(args.find(arg => arg.startsWith('/data/work/jobs/abc/'))).toBeDefined()
		expect(probeArgs({url: item.url}, {...COMMON, limitRate: '2M'})).not.toContain('--limit-rate')
	})
})

describe('probeOnAndroid', () => {
	it('maps a video probe through the shared mapping', async () => {
		const {native, runs} = fakeNative()
		const pending = probeOnAndroid(native, 'probe:1', {url: 'https://www.youtube.com/watch?v=abc'}, COMMON)
		await flush()
		const info = {id: 'abc', title: 'A video', extractor: 'youtube', extractor_key: 'Youtube', webpage_url: 'https://www.youtube.com/watch?v=abc', formats: [{format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360}]}
		runs[0]?.finish({...OK_RUN, stdout: `${JSON.stringify(info)}\n`})
		const result = await pending
		expect(result.ok && result.data.kind === 'video' ? result.data.title : null).toBe('A video')
	})

	it('classifies a failed probe from stderr', async () => {
		const {native, runs} = fakeNative()
		const pending = probeOnAndroid(native, 'probe:1', {url: 'https://example.com/nothing'}, COMMON)
		await flush()
		runs[0]?.finish({exitCode: 1, stdout: '', stderr: 'ERROR: Unsupported URL: https://example.com/nothing', cancelled: false})
		const result = await pending
		expect(!result.ok && result.error.kind === 'ytdlp' ? result.error.error.kind : null).toBe('unsupportedUrl')
	})
})

describe('AndroidQueue', () => {
	it('downloads a pending item, publishes its files and completes it', async () => {
		const {native, runs, removed} = fakeNative()
		const {queue} = makeQueue(native)
		queue.add([makeItem({id: 'a', status: 'pending'})])
		await flush()
		expect(statusOf(queue, 'a')).toBe('running')
		runs[0]?.onLine('[download]  42.0% of ~10.00MiB at  1.00MiB/s ETA 00:06')
		expect(queue.snapshot().items[0]?.progressPercent).toBe(42)
		runs[0]?.finish(OK_RUN)
		await vi.waitFor(() => expect(statusOf(queue, 'a')).toBe('done'))
		expect(queue.snapshot().items[0]?.artifacts.map(artifact => artifact.kind)).toEqual(['media'])
		expect(removed).toEqual(['/data/work/jobs/a'])
	})

	it('runs one item at a time by default', async () => {
		const {native, runs} = fakeNative()
		const {queue} = makeQueue(native)
		queue.add([makeItem({id: 'a', status: 'pending'}), makeItem({id: 'b', status: 'pending'})])
		await flush()
		expect(runs).toHaveLength(1)
		runs[0]?.finish(OK_RUN)
		await vi.waitFor(() => expect(runs).toHaveLength(2))
	})

	it('pauses a running item in place and resumes it in the same job directory', async () => {
		const {native, runs, removed} = fakeNative()
		const {queue} = makeQueue(native)
		queue.add([makeItem({id: 'a', status: 'pending'})])
		await flush()
		queue.pause('a')
		await vi.waitFor(() => expect(statusOf(queue, 'a')).toBe('paused-active'))
		expect(queue.snapshot().items[0]?.tempDir).toBe('/data/work/jobs/a')
		expect(removed).toEqual([])
		queue.resume('a')
		await vi.waitFor(() => expect(runs).toHaveLength(2))
		expect(statusOf(queue, 'a')).toBe('running')
	})

	it('cancels a running item and discards its partial files', async () => {
		const {native, removed} = fakeNative()
		const {queue} = makeQueue(native)
		queue.add([makeItem({id: 'a', status: 'pending'})])
		await flush()
		queue.cancel('a')
		await vi.waitFor(() => expect(statusOf(queue, 'a')).toBe('cancelled'))
		expect(removed).toEqual(['/data/work/jobs/a'])
	})

	it('reports a failed run as an error with the classified kind', async () => {
		const {native, runs} = fakeNative()
		const {queue} = makeQueue(native)
		queue.add([makeItem({id: 'a', status: 'pending'})])
		await flush()
		runs[0]?.finish({exitCode: 1, stdout: '', stderr: "ERROR: [youtube] abc: Sign in to confirm you're not a bot", cancelled: false})
		await vi.waitFor(() => expect(statusOf(queue, 'a')).toBe('error'))
		expect(queue.snapshot().items[0]?.error?.kind).toBe('botBlock')
	})

	it('restarts a run the app was killed in the middle of', async () => {
		const {native, runs} = fakeNative()
		const {queue} = makeQueue(native, memoryPersistence({items: [makeItem({id: 'a', status: 'running', lastJobId: 'old'})], schedulerPaused: false}))
		expect(statusOf(queue, 'a')).toBe('pending')
		queue.kick()
		await flush()
		expect(runs).toHaveLength(1)
	})
})

describe('Android storage', () => {
	function memoryStore(entries: Record<string, string> = {}): KeyValueStore {
		return {get: key => entries[key] ?? null, set: (key, value) => void (entries[key] = value)}
	}

	it('falls back to defaults for corrupt settings and rejects an invalid patch', () => {
		const settings = new AndroidSettingsStore(memoryStore({'arroxy:android:settings': '{not json'}), defaultAppSettings('Download/Arroxy'))
		expect(settings.get().common.defaultOutputDir).toBe('Download/Arroxy')
		expect(settings.update({common: {defaultOutputDir: ''}}).ok).toBe(false)
		expect(settings.update({common: {uiTheme: 'dark'}}).ok).toBe(true)
	})

	it('drops queue rows that no longer match the schema', () => {
		const good = makeItem({id: 'a', status: 'done'})
		const persistence = createQueuePersistence(memoryStore({'arroxy:android:queue': JSON.stringify({items: [good, {id: 'broken'}], schedulerPaused: true})}))
		expect(persistence.load()).toEqual({items: [good], schedulerPaused: true})
	})
})
