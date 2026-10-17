import {describe, expect, it} from 'vite-plus/test'
import {defaultAppSettings} from '@shared/constants.js'
import {queueItemSchema} from '@shared/queueItemSchema.js'
import type {PlaylistProbeResult, VideoProbeResult} from '@shared/types.js'
import {activeQuality, linkFromSharedText, planQueueItems, profileRefFor} from '../../src/android/ui/downloadPlan.js'

const SETTINGS = defaultAppSettings('Download/Pingo')
const NOW = '2026-10-17T00:00:00.000Z'

const VIDEO: VideoProbeResult = {
	kind: 'video',
	videoId: 'abc',
	extractor: 'youtube',
	extractorKey: 'Youtube',
	webpageUrl: 'https://www.youtube.com/watch?v=abc',
	isAudioOnlySource: false,
	formats: [],
	title: 'A video',
	thumbnail: 'https://i.ytimg.com/abc.jpg',
	subtitles: {},
	automaticCaptions: {},
	isLive: false,
	hasDrm: false
}

const PLAYLIST: PlaylistProbeResult = {
	kind: 'playlist',
	extractor: 'youtube:tab',
	extractorKey: 'YoutubeTab',
	webpageUrl: 'https://www.youtube.com/playlist?list=PL1',
	isAudioOnlySource: false,
	isMultiVideo: false,
	playlistId: 'PL1',
	playlistTitle: 'Road trip',
	entries: [
		{id: '1::a', url: 'https://www.youtube.com/watch?v=a', title: 'First', thumbnail: '', playlistIndex: 1, videoId: 'a'},
		{id: '2::b', url: 'https://www.youtube.com/watch?v=b', title: 'Second', thumbnail: '', playlistIndex: 2, videoId: 'b'},
		{id: '3::UCx', url: 'https://www.youtube.com/channel/UCx', title: 'A channel', thumbnail: '', playlistIndex: 3, videoId: 'UCx', isContainer: true}
	]
}

function ids(): () => string {
	let n = 0
	return () => `item-${++n}`
}

describe('linkFromSharedText', () => {
	it('keeps the first link of a share and drops tracking parameters', () => {
		expect(linkFromSharedText('Watch this!\nhttps://youtu.be/abc?si=TRACK123')).toBe('https://youtu.be/abc')
	})

	it('drops trailing punctuation and rejects text without a link', () => {
		expect(linkFromSharedText('(see https://vimeo.com/123).')).toBe('https://vimeo.com/123')
		expect(linkFromSharedText('no link here')).toBeNull()
	})
})

describe('quality choice', () => {
	it('round-trips through the active download profile', () => {
		expect(activeQuality({...SETTINGS, profiles: {...SETTINGS.profiles, active: profileRefFor('audio')}})).toBe('audio')
		expect(activeQuality(SETTINGS)).toBe('p720')
	})
})

describe('planQueueItems', () => {
	it('builds one schema-valid pending item for a video', () => {
		const items = planQueueItems({probe: VIDEO, quality: 'p1080', settings: SETTINGS, formatLabel: '1080p', now: NOW, newId: ids()})
		expect(items).toHaveLength(1)
		expect(queueItemSchema.safeParse(items[0]).success).toBe(true)
		expect(items[0]?.job.kind).toBe('ranged-format')
		expect(items[0]?.job.kind === 'ranged-format' ? items[0].job.formatSort : null).toContain('1080')
	})

	it('builds audio jobs that convert to audio', () => {
		const [item] = planQueueItems({probe: VIDEO, quality: 'audio', settings: SETTINGS, formatLabel: 'Audio', now: NOW, newId: ids()})
		expect(item?.job.kind === 'ranged-format' ? item.job.intent.kind : null).toBe('audio-only')
	})

	it('queues the chosen playlist rows into the playlist folder, skipping containers', () => {
		const items = planQueueItems({probe: PLAYLIST, quality: 'p720', settings: SETTINGS, entries: PLAYLIST.entries, formatLabel: '720p', now: NOW, newId: ids()})
		expect(items.map(item => item.title)).toEqual(['First', 'Second'])
		expect(items[0]?.job.kind === 'ranged-format' ? items[0].job.filenameTemplate : null).toBe('Road trip/{title} [{id}]')
	})
})
