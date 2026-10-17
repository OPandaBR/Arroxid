// What the Android screens turn a probe into: one queue item per video, each
// carrying a job built by the shared profile resolver and job builder, so a
// quality picked on the phone downloads exactly what the same desktop profile
// would. Pure: no React, no AppApi.

import {cleanUrl} from '@shared/cleanUrl.js'
import {DEFAULTS} from '@shared/constants.js'
import {resolveChosenDownloadProfile, resolveDownloadProfile} from '@shared/downloadProfiles.js'
import {compileFilenameTemplate} from '@shared/filenameTemplate.js'
import {prepareJob} from '@shared/prepareJob.js'
import {QUEUE_STATUS} from '@shared/schemas.js'
import {safeFolderName} from '@shared/subfolder.js'
import type {AppSettings, PlaylistEntry, ProbeResult, QueueItem} from '@shared/types.js'

// The phone's quality choices, each backed by a built-in download profile.
export const QUALITY_CHOICES = [
	{id: 'best', profileId: 'best-quality'},
	{id: 'p1080', profileId: 'hd-1080'},
	{id: 'p720', profileId: 'balanced'},
	{id: 'p480', profileId: 'small-file'},
	{id: 'audio', profileId: 'audio-only'}
] as const

export type QualityChoiceId = (typeof QUALITY_CHOICES)[number]['id']

const DEFAULT_QUALITY: QualityChoiceId = 'p720'

// The active profile stays the source of truth, so desktop-style settings
// sync and the phone agree on what "the current quality" is.
export function activeQuality(settings: AppSettings): QualityChoiceId {
	const active = settings.profiles.active
	return QUALITY_CHOICES.find(choice => active.kind === 'builtin' && active.id === choice.profileId)?.id ?? DEFAULT_QUALITY
}

export function profileRefFor(quality: QualityChoiceId): AppSettings['profiles']['active'] {
	return {kind: 'builtin', id: QUALITY_CHOICES.find(choice => choice.id === quality)?.profileId ?? 'balanced'}
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i

// A share from another app is free text ("Look at this! https://…"): keep
// the first link, without tracking parameters.
export function linkFromSharedText(text: string): string | null {
	const match = URL_PATTERN.exec(text)
	if (!match) return null
	const trimmed = match[0].replace(/[).,;!?]+$/, '')
	try {
		return cleanUrl(new URL(trimmed).toString())
	} catch {
		return null
	}
}

function filenameTemplateFor(folder: string | null): string {
	if (!folder) return DEFAULTS.filenameTemplate
	const candidate = `${folder}/${DEFAULTS.filenameTemplate}`
	return compileFilenameTemplate(candidate).ok ? candidate : DEFAULTS.filenameTemplate
}

interface PlanInput {
	probe: ProbeResult
	quality: QualityChoiceId
	settings: AppSettings
	// Playlist rows to download; ignored for a single video.
	entries?: readonly PlaylistEntry[]
	formatLabel: string
	now: string
	newId: () => string
}

interface Target {
	url: string
	title: string
	thumbnail: string
}

export function planQueueItems(input: PlanInput): QueueItem[] {
	const {probe, settings} = input
	const {profile, ref} = resolveChosenDownloadProfile(profileRefFor(input.quality), settings.profiles)
	const resolved = resolveDownloadProfile(profile, ref, settings.common.nativeAudioPreference)
	if (!resolved.intent) return []
	const isPlaylist = probe.kind === 'playlist'
	const folder = isPlaylist ? safeFolderName(probe.playlistTitle) : null
	const job = prepareJob({
		mode: 'playlist',
		extractor: probe.extractor,
		extractorKey: probe.extractorKey,
		mediaIntent: resolved.intent,
		nativeAudioPreference: settings.common.nativeAudioPreference,
		filenameTemplate: filenameTemplateFor(folder),
		subtitles: resolved.subtitles,
		sponsorBlockMode: resolved.sponsorBlock.mode,
		sponsorBlockCategories: resolved.sponsorBlock.mode === 'off' ? [] : resolved.sponsorBlock.categories,
		embed: resolved.embed
	})
	const targets: Target[] = isPlaylist ? (input.entries ?? []).filter(entry => entry.isContainer !== true).map(entry => ({url: entry.url, title: entry.title, thumbnail: entry.thumbnail})) : [{url: probe.webpageUrl, title: probe.title, thumbnail: probe.thumbnail}]
	return targets.map(target => ({
		id: input.newId(),
		url: target.url,
		title: target.title,
		thumbnail: target.thumbnail,
		outputDir: settings.common.defaultOutputDir,
		formatLabel: input.formatLabel,
		status: QUEUE_STATUS.pending,
		lane: 'normal',
		progressPercent: 0,
		progressDetail: null,
		lastStatus: null,
		error: null,
		addedAt: input.now,
		finishedAt: null,
		writeM3u: false,
		retryCount: 0,
		artifacts: [],
		job
	}))
}
