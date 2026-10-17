import {describe, expect, it} from 'vite-plus/test'
import {formatDuration, hostOf, progressFacts} from '../../src/android/ui/format.js'

describe('Android UI formatting', () => {
	it('formats durations the way a phone shows them', () => {
		expect(formatDuration(65)).toBe('1:05')
		expect(formatDuration(3725)).toBe('1:02:05')
		expect(formatDuration(undefined)).toBeNull()
	})

	it('reads size, speed and ETA out of a yt-dlp progress line', () => {
		expect(progressFacts('42.0% of ~10.00MiB at  1.20MiB/s ETA 00:06')).toEqual({size: '10.00MiB', speed: '1.20MiB/s', eta: '00:06'})
		expect(progressFacts(null)).toEqual({size: null, speed: null, eta: null})
	})

	it('shows a link by its host', () => {
		expect(hostOf('https://www.youtube.com/watch?v=x')).toBe('youtube.com')
	})
})
