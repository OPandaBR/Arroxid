// One queue item's download on the Android shell: the media run, then the soft
// sidecar-subtitle run (see the Subtitle Pipeline in AGENTS.md), then the move
// of every produced file into the public download folder.

import {parseYtDlpOutputLine} from 'yt-dlp-bridge/parsers'
import {classifyYtDlpStderr} from 'ytdlp-errors'
import {artifactKindForPath} from '@shared/queueArtifacts.js'
import {STATUS_KEY, type StatusKey} from '@shared/schemas.js'
import type {CommonSettings, LocalizedError, PreparedJob, QueueArtifact} from '@shared/types.js'
import type {AndroidNativePort, YtDlpRun} from './nativePort.js'
import {mediaArgs, subtitleArgs} from './ytDlpArgs.js'

export type ResolvedJob = Exclude<PreparedJob, {kind: 'unresolved'}>

export interface JobProgress {
	percent?: number
	detail: string | null
	statusKey: StatusKey
}

export type JobOutcome = {kind: 'done'; artifacts: QueueArtifact[]; subtitlesFailed: boolean} | {kind: 'failed'; error: LocalizedError} | {kind: 'stopped'}

export interface JobRequest {
	native: AndroidNativePort
	runId: string
	url: string
	job: ResolvedJob
	jobDir: string
	common: CommonSettings
	now: () => string
	onProgress: (progress: JobProgress) => void
}

function statusKeyForLine(line: string): JobProgress | null {
	const event = parseYtDlpOutputLine(line)
	if (!event) return null
	switch (event.kind) {
		case 'progress':
			return {...(event.percent !== undefined ? {percent: event.percent} : {}), detail: event.raw.replace(/^\[download\]\s*/, ''), statusKey: STATUS_KEY.downloadingMedia}
		case 'merge':
			return {detail: null, statusKey: STATUS_KEY.mergingFormats}
		case 'postprocess':
			// The bridge's postprocess phases are named after their status keys.
			return {detail: null, statusKey: STATUS_KEY[event.phase]}
		case 'sleep':
			return {detail: null, statusKey: STATUS_KEY.sleepingBetweenRequests}
		case 'sponsorblock-fetch':
			return {detail: null, statusKey: STATUS_KEY.fetchingSponsorBlock}
		case 'transfer-retry':
			return {detail: null, statusKey: STATUS_KEY.retryingTransfer}
		default:
			return null
	}
}

function failureOf(run: YtDlpRun): LocalizedError {
	const raw = run.stderr.trim() || `yt-dlp exited with code ${run.exitCode}`
	return {kind: classifyYtDlpStderr(raw).kind, raw}
}

function runAndReport(req: JobRequest, args: string[]): Promise<YtDlpRun> {
	return req.native.runYtDlp(req.runId, args, line => {
		const progress = statusKeyForLine(line)
		if (progress) req.onProgress(progress)
	})
}

export async function runQueueJob(req: JobRequest): Promise<JobOutcome> {
	const {job} = req
	let subtitlesFailed = false
	req.onProgress({percent: 0, detail: null, statusKey: STATUS_KEY.startingYtdlp})

	if (job.kind === 'subtitle-only') {
		req.onProgress({detail: null, statusKey: STATUS_KEY.fetchingSubtitles})
		const run = await runAndReport(req, subtitleArgs({url: req.url, subtitles: job.subtitles, filenameTemplate: job.filenameTemplate, outputDir: req.jobDir}, req.common))
		if (run.cancelled) return {kind: 'stopped'}
		if (run.exitCode !== 0) return {kind: 'failed', error: failureOf(run)}
	} else {
		const run = await runAndReport(req, mediaArgs({url: req.url, job, outputDir: req.jobDir}, req.common))
		if (run.cancelled) return {kind: 'stopped'}
		if (run.exitCode !== 0) return {kind: 'failed', error: failureOf(run)}
		const subtitles = job.subtitles
		if (subtitles && subtitles.mode !== 'embed' && subtitles.languages.length > 0) {
			req.onProgress({detail: null, statusKey: STATUS_KEY.fetchingSubtitles})
			const subs = await runAndReport(req, subtitleArgs({url: req.url, subtitles, filenameTemplate: job.filenameTemplate, outputDir: req.jobDir}, req.common))
			if (subs.cancelled) return {kind: 'stopped'}
			subtitlesFailed = subs.exitCode !== 0
		}
	}

	req.onProgress({detail: null, statusKey: STATUS_KEY.movingFiles})
	const published = await req.native.publish(req.jobDir)
	await req.native.removeDir(req.jobDir)
	const discoveredAt = req.now()
	const artifacts = published.map((file, index): QueueArtifact => ({id: `${req.runId}-${index}`, kind: artifactKindForPath(file.name), path: file.relativePath, fileName: file.name, sizeBytes: file.sizeBytes, discoveredAt}))
	return {kind: 'done', artifacts, subtitlesFailed}
}
