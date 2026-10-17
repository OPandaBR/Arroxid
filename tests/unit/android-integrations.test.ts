import {describe, expect, it} from 'vite-plus/test'
import {defaultAppSettings} from '@shared/constants.js'
import {probeArgs} from '../../src/android/ytDlpArgs.js'
import {progressNotice, resultNotice} from '../../src/android/ui/notices.js'
import {pickAndroidUpdate} from '../../src/android/updateCheck.js'
import {makeItem} from '../shared/fixtures.js'

const COMMON = defaultAppSettings('Download/Pingo').common

describe('cookies on Android', () => {
	it('passes the imported cookies file to every run, like desktop file mode', () => {
		const args = probeArgs({url: 'https://www.youtube.com/watch?v=a'}, {...COMMON, cookiesMode: 'file', cookiesPath: '/data/arroxy/cookies.txt'})
		expect(args).toEqual(expect.arrayContaining(['--cookies', '/data/arroxy/cookies.txt']))
	})

	it('passes nothing when cookies are off', () => {
		expect(probeArgs({url: 'https://www.youtube.com/watch?v=a'}, {...COMMON, cookiesMode: 'off', cookiesPath: '/data/arroxy/cookies.txt'})).not.toContain('--cookies')
	})
})

describe('progress notification', () => {
	it('is absent while nothing runs', () => {
		expect(progressNotice([makeItem({id: 'a', status: 'done'})])).toBeNull()
	})

	it('names the one running item with its progress and what is queued', () => {
		const notice = progressNotice([makeItem({id: 'a', status: 'running', title: 'Song', progressPercent: 40, progressDetail: '40.0% of 10.00MiB at 1.00MiB/s ETA 00:06'}), makeItem({id: 'b', status: 'pending'})])
		expect(notice).toMatchObject({title: 'Song', percent: 40, paused: false})
		expect(notice?.text).toContain('1.00MiB/s')
		expect(notice?.text).toContain('1')
		expect(notice?.actionLabel).not.toBeNull()
	})

	it('counts several running items and averages their progress', () => {
		const notice = progressNotice([makeItem({id: 'a', status: 'running', progressPercent: 20}), makeItem({id: 'b', status: 'running', progressPercent: 60})])
		expect(notice?.percent).toBe(40)
		expect(notice?.title).toContain('2')
	})
})

describe('result notification', () => {
	it('fires once when an item finishes, pointing at its media file', () => {
		const before = makeItem({id: 'a', status: 'running', title: 'Song'})
		const after = {...makeItem({id: 'a', status: 'done', title: 'Song'}), artifacts: [{id: 'x', kind: 'media' as const, path: 'Download/Pingo/Song.mp4', fileName: 'Song.mp4', discoveredAt: 'now'}]}
		expect(resultNotice(before, after)).toMatchObject({text: 'Song', relativePath: 'Download/Pingo/Song.mp4'})
		expect(resultNotice(after, after)).toBeNull()
	})

	it('fires for a failure with the reason, and not for a cancel', () => {
		const before = makeItem({id: 'a', status: 'running', title: 'Song'})
		const failed = makeItem({id: 'a', status: 'error', title: 'Song', error: {kind: 'network', raw: 'boom'}})
		expect(resultNotice(before, failed)?.text).toContain('Song')
		expect(resultNotice(before, makeItem({id: 'a', status: 'cancelled'}))).toBeNull()
	})
})

describe('update check', () => {
	const release = (tag: string, assets: string[]): unknown => ({tag_name: tag, html_url: `https://github.com/x/releases/tag/${tag}`, assets: assets.map(name => ({name, browser_download_url: `https://dl/${name}`}))})

	it('offers a newer release only when it ships a Pingo APK', () => {
		expect(pickAndroidUpdate(release('v0.6.0', ['pingo-arm64-v8a-release.apk', 'Arroxy-Setup.exe']), '0.5.2')).toEqual({version: '0.6.0', url: 'https://github.com/x/releases/tag/v0.6.0'})
		expect(pickAndroidUpdate(release('v0.6.0', ['Arroxy-Setup.exe', 'other-app.apk']), '0.5.2')).toBeNull()
	})

	it('ignores the same or an older version, and malformed replies', () => {
		expect(pickAndroidUpdate(release('v0.5.2', ['pingo-arm64-v8a-release.apk']), '0.5.2')).toBeNull()
		expect(pickAndroidUpdate(release('v0.4.9', ['pingo-arm64-v8a-release.apk']), '0.5.2')).toBeNull()
		expect(pickAndroidUpdate({nope: true}, '0.5.2')).toBeNull()
	})
})
