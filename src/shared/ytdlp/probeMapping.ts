// Pure yt-dlp probe output mapping: stdout/stderr of a `--dump-single-json`
// run in, a ProbeResult (or a classified failure) out. Shared by every host that
// runs probes (Electron main's ProbeService, the Android host), so both read
// yt-dlp the same way. No I/O; logging goes through the injected port.

import {LIVE_CHAT_LANG} from '../constants.js'
import {placeholderTitleFlag} from '../queueTitle.js'
import {siteForExtractor, type Site} from '../sites/index.js'
import type {PlaylistEntry, PlaylistProbeResult, ProbeDegradationReason, ProbeError, ProbeInfoJsonRef, ProbeProgressEvent, SubtitleMap, VideoProbeResult} from '../types.js'
import {classifyYtDlpStderr, type YtDlpErrorKind} from 'ytdlp-errors'
import {isAudioOnlySource} from './extractorPredicates.js'
import {isPlaylistLike, isUrlRedirect, type InfoDict, type MultiVideoInfo, type PlaylistInfo, type VideoInfo, type YtDlpSubtitleTrack} from './infoDict.js'
import {mapFormats} from './probeFormatMapping.js'

export interface ProbeMappingLog {
	info(message: string, meta: Record<string, unknown>): void
	warn(message: string, meta: Record<string, unknown>): void
}

const SILENT_PROBE_MAPPING_LOG: ProbeMappingLog = {info: () => undefined, warn: () => undefined}

type ProbeSignalCategory = 'extractor' | 'bot'

// Patterns sourced from yt-dlp's stderr emit sites — verified against
// yt-dlp/yt_dlp/extractor/youtube/_video.py and yt-dlp/yt_dlp/downloader/common.py
// (search the repo for each exact string). yt-dlp wording occasionally changes
// across releases; if a probe stops triggering the degradation retry path,
// re-grep yt-dlp main and update these patterns.
const PROBE_DEGRADATION_SIGNALS: readonly {label: string; pattern: RegExp; category: ProbeSignalCategory}[] = [
	{label: 'n challenge solving failed', pattern: /n challenge solving failed/i, category: 'extractor'},
	{label: 'Some formats may be missing', pattern: /some formats may be missing/i, category: 'extractor'},
	{label: 'Error solving n challenge request', pattern: /error solving n challenge request/i, category: 'extractor'},
	{label: 'Failed to download m3u8 information', pattern: /failed to download m3u8 information/i, category: 'extractor'},
	{label: 'Unable to download webpage', pattern: /unable to download webpage/i, category: 'extractor'},
	{label: 'IncompleteRead', pattern: /incompleteread/i, category: 'extractor'},
	{label: 'Sign in to confirm', pattern: /sign in to confirm you'?re not a bot/i, category: 'bot'},
	{label: 'HTTP 429', pattern: /HTTP Error 429\b|too many requests/i, category: 'bot'}
]

export interface ProbeSignal {
	label: string
	category: ProbeSignalCategory
}

export interface ProbeAttemptSuccess {
	info: InfoDict
	raw: unknown
	stderr: string
	degradationSignals: ProbeSignal[]
}

export type ProbeAttemptResult = {kind: 'success'; data: ProbeAttemptSuccess} | {kind: 'failure'; error: ProbeError}

export const PROBE_CANCELLED = {kind: 'failure', error: {kind: 'other', code: 'cancelled', message: 'Probe cancelled'}} as const satisfies ProbeAttemptResult

function sanitizeSubtitleMap(raw: Record<string, YtDlpSubtitleTrack[]> | undefined, opts: {isAutomaticCaptions: boolean; site: Site}): SubtitleMap {
	if (!raw) return {}
	const result: SubtitleMap = {}
	// Site adapter decides whether auto-caption keys must end in `-orig`. YouTube
	// bundles real generated tracks with on-demand translation options under the
	// same map; only `-orig` are real. Other sites emit auto-captions under bare
	// lang codes — applying the filter would discard every track.
	const requireOrig = opts.isAutomaticCaptions && opts.site.autoCaptionRequiresOrigSuffix
	for (const [lang, tracks] of Object.entries(raw)) {
		if (lang === LIVE_CHAT_LANG) continue
		if (requireOrig && !lang.endsWith('-orig')) continue
		const valid = tracks.flatMap(t => (typeof t.ext === 'string' && t.ext.length > 0 ? [{ext: t.ext, ...(t.name ? {name: t.name} : {})}] : []))
		if (valid.length > 0) result[lang] = valid
	}
	return result
}

// `Unsupported URL` is emitted by yt-dlp before any extraction begins; it
// doesn't match any of the post-extraction stderr patterns. Detect it here so
// the user gets the right copy + CTA.
export function classifyProbeFailure(rawError: string): YtDlpErrorKind {
	if (/unsupported url|is not a supported (?:site|url)|no extractor matches/i.test(rawError)) {
		return 'unsupportedUrl'
	}
	return classifyYtDlpStderr(rawError).kind
}

export function detectProbeDegradationSignals(stderr: string): ProbeSignal[] {
	return PROBE_DEGRADATION_SIGNALS.flatMap(({pattern, label, category}) => (pattern.test(stderr) ? [{label, category}] : []))
}

const PLAYLIST_ITEM_PROGRESS_RE = /\[download\]\s+Downloading item\s+(\d+)\s+of\s+(\d+|N\/A)/i
const YOUTUBE_TAB_PAGE_PROGRESS_RE = /\[youtube:tab\]\s+.+?\spage\s+(\d+):\s+Downloading API JSON/i

function stripAnsiEscapeSequences(line: string): string {
	let clean = ''
	for (let index = 0; index < line.length;) {
		if (line.charCodeAt(index) === 27 && line[index + 1] === '[') {
			index += 2
			while (index < line.length) {
				const code = line.charCodeAt(index)
				index += 1
				if (code >= 0x40 && code <= 0x7e) break
			}
			continue
		}
		clean += line[index]
		index += 1
	}
	return clean
}

export function parseProbeProgressLine(line: string): Pick<ProbeProgressEvent, 'phase' | 'loaded' | 'total'> | null {
	const clean = stripAnsiEscapeSequences(line)
	const pageMatch = YOUTUBE_TAB_PAGE_PROGRESS_RE.exec(clean)
	if (pageMatch) {
		const loaded = Number(pageMatch[1])
		return Number.isFinite(loaded) ? {phase: 'pages', loaded} : null
	}
	const itemMatch = PLAYLIST_ITEM_PROGRESS_RE.exec(clean)
	if (!itemMatch) return null
	const loaded = Number(itemMatch[1])
	if (!Number.isFinite(loaded)) return null
	const rawTotal = itemMatch[2]
	const total = rawTotal && rawTotal !== 'N/A' ? Number(rawTotal) : undefined
	return {phase: 'items', loaded, ...(total !== undefined && Number.isFinite(total) ? {total} : {})}
}

export function parseProbeJsonOutput(stdout: string): unknown {
	let lastJsonError: unknown = null
	const lines = stdout.split(/\r?\n/).flatMap(line => {
		const trimmedLine = line.trim()
		return trimmedLine ? [trimmedLine] : []
	})
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]
		if (!line?.startsWith('{')) continue
		try {
			return JSON.parse(line)
		} catch (error) {
			lastJsonError = error
		}
	}
	if (lastJsonError) throw lastJsonError
	return JSON.parse(stdout)
}

function deriveDegraded(signals: ProbeSignal[]): {reasons: ProbeDegradationReason[]} | undefined {
	if (signals.length === 0) return undefined
	const reasons = Array.from(new Set(signals.map(s => (s.category === 'bot' ? 'botWall' : 'extractor')))) as ProbeDegradationReason[]
	return {reasons}
}

// The renderer CSP allows `img-src 'self' data: https:` — no plaintext http.
// Several extractors (Bilibili's i0.hdslb.com among them) hand back http URLs,
// which the renderer then refuses to load, leaving a broken thumbnail. The CDNs
// serve the identical bytes over https, so upgrade the scheme here rather than
// widening the CSP: allowing http images would let a network attacker inject
// arbitrary picture content into the picker.
function upgradeThumbnailScheme(url: string): string {
	return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url
}

function pickEntryThumbnail(entry: InfoDict): string {
	const v = entry as VideoInfo
	if (typeof v.thumbnail === 'string' && v.thumbnail.length > 0) return upgradeThumbnailScheme(v.thumbnail)
	const list = v.thumbnails
	if (!list || list.length === 0) return ''
	// Some extractors (NicoVideo) emit thumbnail entries with `url: null` as
	// placeholders — find the first entry with a usable URL.
	for (const t of list) {
		if (typeof t.url === 'string' && t.url.length > 0) return upgradeThumbnailScheme(t.url)
	}
	return ''
}

function untitledLabel(playlistIndex: number): string {
	return `Untitled · #${playlistIndex}`
}

// Browse-id playlist hints + nested-container detection now live on the Site
// adapter (src/shared/sites/youtube.ts). For non-YouTube sites these methods
// are absent and the helpers below short-circuit cleanly.
function siteHintForId(site: Site, id: string): string | null {
	return site.hintForPlaylistId ? site.hintForPlaylistId(id) : null
}

function siteIsNestedContainer(site: Site, id: string): boolean {
	return site.isNestedContainer ? site.isNestedContainer({id}) : false
}

function buildEntryUrl(entry: InfoDict): string | null {
	// _type='url' / 'url_transparent' / 'video': webpage_url is canonical when present.
	// Flat-playlist entries often only have `url` (the watch URL) — accept either.
	const v = entry as VideoInfo & {url?: string}
	if (typeof v.webpage_url === 'string' && v.webpage_url.length > 0) return v.webpage_url
	if (typeof v.url === 'string' && v.url.startsWith('http')) return v.url
	return null
}

export function mapPlaylistEntries(entries: readonly InfoDict[], jobUrl: string, siteOrExtractor: Site | string, log: ProbeMappingLog = SILENT_PROBE_MAPPING_LOG): PlaylistEntry[] {
	const site = typeof siteOrExtractor === 'string' ? siteForExtractor(siteOrExtractor) : siteOrExtractor
	return mapPlaylistEntriesInner(entries, jobUrl, site, log)
}

function mapPlaylistEntriesInner(entries: readonly InfoDict[], jobUrl: string, site: Site, log: ProbeMappingLog): PlaylistEntry[] {
	// First pass: detect whether the result set contains any real video entry
	// (id without a known container prefix). If yes, the heterogeneous-result
	// case applies and we'll filter containers out below. If no (all nested),
	// we keep them — better than an empty picker.
	let hasVideoEntries = false
	for (const entry of entries) {
		const id = typeof (entry as VideoInfo).id === 'string' ? (entry as VideoInfo).id! : ''
		if (id && !siteIsNestedContainer(site, id)) {
			hasVideoEntries = true
			break
		}
	}

	const out: PlaylistEntry[] = []
	let fallbackIndex = 1
	let droppedContainerCount = 0
	for (const entry of entries) {
		const url = buildEntryUrl(entry)
		if (!url) {
			log.warn('Playlist entry skipped — no resolvable URL', {jobUrl, entryId: typeof (entry as VideoInfo).id === 'string' ? (entry as VideoInfo).id : '(none)'})
			fallbackIndex++
			continue
		}
		const v = entry as VideoInfo & {playlist_index?: number}
		const playlistIndex = typeof v.playlist_index === 'number' ? v.playlist_index : fallbackIndex
		const idStr = typeof v.id === 'string' ? v.id : ''
		// Heterogeneous-result filter: when the set contains any actual video,
		// drop nested containers (channel/playlist/album/mix). Selecting them
		// would silently download their entire contents, which doesn't fit the
		// wizard's "pick videos" model. If the set is entirely nested (no
		// videos at all — pure music-category search), we keep everything so
		// the picker isn't empty.
		if (hasVideoEntries && idStr && siteIsNestedContainer(site, idStr)) {
			droppedContainerCount++
			fallbackIndex++
			continue
		}
		// Fallback chain: explicit title → site-specific id hint → neutral
		// placeholder. The id hint is YouTube-only today (browse-id prefixes);
		// generic sites return null and fall through to the placeholder. Only the
		// final placeholder branch marks titleIsPlaceholder — the id hint is a
		// real site-provided hint, not a fabrication.
		const rawTitle = typeof v.title === 'string' ? v.title.trim() : ''
		const idHint = idStr ? siteHintForId(site, idStr) : null
		const isPlaceholderTitle = rawTitle.length === 0 && idHint == null
		const title = rawTitle.length > 0 ? rawTitle : (idHint ?? untitledLabel(playlistIndex))
		// PlaylistEntry.id must be unique per row, not per video. YouTube mix /
		// radio feeds frequently repeat the same video at multiple positions;
		// collapsing them to one id would make the selection state and the
		// post-confirm filter (`playlistItems.filter(e => ids.includes(e.id))`)
		// treat them as one — clicking one would check both, and a single
		// selection would produce two queue items. Index-prefixing guarantees
		// 1 row = 1 stable id even when the underlying yt-dlp id collides.
		const videoIdPart = typeof v.id === 'string' && v.id.length > 0 ? v.id : url
		// Only reachable on the all-nested path — the branch above already
		// dropped containers whenever the set held a real video. Marking rather
		// than dropping keeps the picker populated; downstream refuses to queue
		// them, which is what the flag exists for.
		const isContainer = idStr.length > 0 && siteIsNestedContainer(site, idStr)
		const entryTimestamp = resolveTimestamp(v)
		out.push({
			id: `${playlistIndex}::${videoIdPart}`,
			url,
			title,
			thumbnail: pickEntryThumbnail(entry),
			duration: typeof v.duration === 'number' ? Math.round(v.duration) : undefined,
			playlistIndex,
			videoId: idStr.length > 0 ? idStr : null,
			uploader: resolveUploader(v),
			uploadDate: resolveUploadDate(v),
			...(entryTimestamp !== undefined ? {timestamp: entryTimestamp} : {}),
			...(isContainer ? {isContainer: true as const} : {}),
			...placeholderTitleFlag(isPlaceholderTitle)
		})
		fallbackIndex++
	}
	if (droppedContainerCount > 0) {
		log.info('Playlist entries filtered: dropped nested containers', {jobUrl, droppedContainerCount, keptCount: out.length})
	}
	return out
}

/**
 * Resolve the uploader the same way the compiled `{uploader}` output template
 * does (`%(uploader,channel,creator,uploader_id)`). Arroxy renders `{uploader}`
 * itself in directory position, so drifting from that chain would put a video
 * in a folder named differently from the file yt-dlp writes inside it.
 */
function resolveUploader(source: {uploader?: string; channel?: string; creator?: string; uploader_id?: string}): string | undefined {
	for (const candidate of [source.uploader, source.channel, source.creator, source.uploader_id]) {
		if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
	}
	return undefined
}

function resolveUploadDate(source: {upload_date?: string}): string | undefined {
	// Anything not YYYYMMDD would render a nonsense folder name, so drop it.
	return source.upload_date !== undefined && /^\d{8}$/.test(source.upload_date) ? source.upload_date : undefined
}

function resolveTimestamp(source: {timestamp?: number}): number | undefined {
	// Epoch seconds from yt-dlp. uploadDate is YYYYMMDD — too coarse to order
	// same-day uploads within a series — so the sort control needs this finer
	// value. Anything non-finite, non-integer, or non-positive is not a real
	// timestamp, so drop it the same way resolveUploadDate drops malformed dates.
	return typeof source.timestamp === 'number' && Number.isFinite(source.timestamp) && Number.isInteger(source.timestamp) && source.timestamp > 0 ? source.timestamp : undefined
}

function buildVideoProbeResult(info: VideoInfo, jobUrl: string, degraded: {reasons: ProbeDegradationReason[]} | undefined, probeInfoJsonRef?: ProbeInfoJsonRef): VideoProbeResult {
	const extractor = info.extractor ?? ''
	const site = siteForExtractor(extractor)
	return {
		kind: 'video',
		videoId: typeof info.id === 'string' && info.id.length > 0 ? info.id : null,
		...(probeInfoJsonRef ? {probeInfoJsonRef} : {}),
		extractor,
		extractorKey: info.extractor_key ?? '',
		webpageUrl: info.webpage_url ?? jobUrl,
		isAudioOnlySource: isAudioOnlySource(extractor),
		formats: mapFormats(info.formats ?? []),
		title: info.title ?? '',
		thumbnail: upgradeThumbnailScheme(info.thumbnail ?? ''),
		duration: typeof info.duration === 'number' ? Math.round(info.duration) : undefined,
		subtitles: sanitizeSubtitleMap(info.subtitles, {isAutomaticCaptions: false, site}),
		automaticCaptions: sanitizeSubtitleMap(info.automatic_captions, {isAutomaticCaptions: true, site}),
		isLive: info.is_live === true || info.live_status === 'is_live' || info.live_status === 'is_upcoming',
		hasDrm: info.has_drm === true,
		availability: typeof info.availability === 'string' ? info.availability : undefined,
		ageLimit: typeof info.age_limit === 'number' && info.age_limit > 0 ? info.age_limit : undefined,
		uploader: resolveUploader(info),
		uploadDate: resolveUploadDate(info),
		timestamp: resolveTimestamp(info),
		...(degraded ? {degraded} : {})
	}
}

function buildPlaylistProbeResult(info: PlaylistInfo | MultiVideoInfo, jobUrl: string, log: ProbeMappingLog): PlaylistProbeResult {
	const extractor = info.extractor ?? ''
	const site = siteForExtractor(extractor)
	return {
		kind: 'playlist',
		extractor,
		extractorKey: info.extractor_key ?? '',
		webpageUrl: info.webpage_url ?? jobUrl,
		isAudioOnlySource: isAudioOnlySource(extractor),
		isMultiVideo: info._type === 'multi_video',
		playlistId: info.playlist_id ?? info.id ?? '',
		playlistTitle: info.playlist_title ?? info.title ?? '',
		entries: mapPlaylistEntries(info.entries, jobUrl, site, log)
	}
}

export type ProbeOutcome = Extract<ProbeAttemptResult, {kind: 'failure'}> | {kind: 'playlist'; result: PlaylistProbeResult} | {kind: 'video'; result: VideoProbeResult; video: VideoInfo; final: ProbeAttemptSuccess}

// Valid extractor output that still holds nothing to download is a failure too.
// Deciding it before escalation lets an empty Watch Later retry signed in.
export function mapProbeAttempt(attempt: ProbeAttemptResult, url: string, logContext: Record<string, unknown>, log: ProbeMappingLog = SILENT_PROBE_MAPPING_LOG): ProbeOutcome {
	if (attempt.kind === 'failure') return attempt
	const final = attempt.data
	const info = final.info
	if (isPlaylistLike(info)) {
		const result = buildPlaylistProbeResult(info, url, log)
		if (result.entries.length > 0) return {kind: 'playlist', result}
		// Not a JSON parse failure: the extractor produced a valid container with
		// no entries (private, members-only, geo-blocked, exhausted page).
		log.warn('Playlist probe returned no entries', {url, ...logContext})
		return {kind: 'failure', error: {kind: 'other', code: 'playlist_empty', message: 'Playlist returned no entries'}}
	}
	// Hit the redirect-depth cap. Surface the URL error rather than guess.
	if (isUrlRedirect(info)) return {kind: 'failure', error: {kind: 'other', code: 'redirect_loop', message: 'Probe redirected too many times'}}
	const result = buildVideoProbeResult(info, url, deriveDegraded(final.degradationSignals))
	// Zero formats + zero subs + zero auto-captions: geo-block, age-gate,
	// members-only, or live-not-yet. The JSON shape itself was fine.
	if (result.formats.length === 0 && Object.keys(result.subtitles).length === 0 && Object.keys(result.automaticCaptions).length === 0) {
		return {kind: 'failure', error: {kind: 'other', code: 'no_formats', message: 'Probe returned no formats'}}
	}
	return {kind: 'video', result, video: info, final}
}
