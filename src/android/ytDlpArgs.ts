// yt-dlp argv for the Android shell, planned by the same yt-dlp-bridge planner
// and request builders Electron main uses. Only the shell extras differ: the
// native shell supplies `--ffmpeg-location` and `--no-cache-dir` itself, and
// there is no PO-token minting or JS runtime on Android.

import {planWorkflow} from 'yt-dlp-bridge'
import {buildMediaRequest, type MediaJob} from '@shared/mediaRequest.js'
import {resolveNetworkPacing, resolvePlaylistProbeLimit} from '@shared/networkPacing.js'
import {siteForUrl} from '@shared/sites/index.js'
import {ytDlpSubtitleLanguages} from '@shared/subtitleLanguages.js'
import {compiledOutputTemplate} from '@shared/filenameTemplate.js'
import type {SubtitleOptions} from '@shared/preparedJob.js'
import type {CommonSettings, ProbeInput} from '@shared/types.js'
import {YOUTUBE_SINGLE_VIDEO_PLAYER_CLIENTS} from '@shared/youtubePlayerClients.js'

function shellArgs(common: CommonSettings, opts: {media: boolean}): string[] {
	const proxy = common.proxyUrl?.trim()
	const limitRate = opts.media ? common.limitRate?.trim() : undefined
	return ['--encoding', 'utf-8', ...(proxy ? ['--proxy', proxy] : []), ...(limitRate ? ['--limit-rate', limitRate] : [])]
}

export function probeArgs(input: ProbeInput, common: CommonSettings): string[] {
	const extractor = siteForUrl(input.url).id === 'youtube' ? {youtube: {playerClient: [...YOUTUBE_SINGLE_VIDEO_PLAYER_CLIENTS]}} : undefined
	const plan = planWorkflow({kind: 'probe', url: input.url, selection: {playlistMode: input.playlistMode ?? 'auto', ...(input.playlistScope ? {playlistScope: input.playlistScope} : {})}, ...(extractor ? {extractor} : {})}, {pacing: resolveNetworkPacing(common), playlistProbeLimit: resolvePlaylistProbeLimit(common)})
	return [...shellArgs(common, {media: false}), ...plan.args]
}

export function mediaArgs(input: {url: string; job: MediaJob; outputDir: string}, common: CommonSettings): string[] {
	const embed = input.job.subtitles?.mode === 'embed'
	const plan = planWorkflow(buildMediaRequest({url: input.url, job: input.job, outputDir: input.outputDir, embed}), {pacing: resolveNetworkPacing(common)})
	return [...shellArgs(common, {media: true}), ...plan.args]
}

export function subtitleArgs(input: {url: string; subtitles: SubtitleOptions; filenameTemplate: string | undefined; outputDir: string}, common: CommonSettings): string[] {
	const template = compiledOutputTemplate(input.filenameTemplate)
	const plan = planWorkflow(
		{
			kind: 'subtitles',
			url: input.url,
			output: {directory: input.outputDir, subtitleMode: input.subtitles.mode, ...(template ? {template} : {})},
			subtitles: {languages: ytDlpSubtitleLanguages(input.subtitles), format: input.subtitles.format, writeAuto: input.subtitles.writeAuto, ...(input.subtitles.autoOnly ? {autoOnly: true} : {})}
		},
		{pacing: resolveNetworkPacing(common)}
	)
	return [...shellArgs(common, {media: false}), ...plan.args]
}
