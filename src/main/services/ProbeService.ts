import {EventEmitter} from 'node:events'
import log from 'electron-log/main.js'
import {splitStderrLines} from '@main/utils/process.js'
import {nowIso} from '@main/utils/clock.js'
import {ok, fail, type Result} from '@shared/result.js'
import type {JobAuth, PlaylistScope, ProbeError, ProbePlaylistMode, ProbeProgressEvent, ProbeResult} from '@shared/types.js'
import type {EscalationReason, ExploreSignInState} from '@shared/schemas.js'
import {infoDictSchema, isPlaylistLike, isUrlRedirect, type InfoDict, type VideoInfo} from '@shared/ytdlp/infoDict.js'
import {classifyProbeFailure, detectProbeDegradationSignals, mapProbeAttempt, parseProbeJsonOutput, parseProbeProgressLine, PROBE_CANCELLED, type ProbeAttemptResult, type ProbeMappingLog, type ProbeOutcome} from '@shared/ytdlp/probeMapping.js'
import {siteForUrl} from '@shared/sites/index.js'
import {YOUTUBE_SINGLE_VIDEO_PLAYER_CLIENTS} from '@shared/youtubePlayerClients.js'
import {PROBE_TIMEOUT_MESSAGE, YtDlp, type RunIdentity} from './YtDlp.js'
import {escalationReason, reachesPlaylistItems} from './exploreEscalation.js'
import type {ExploreGate} from './exploreGate.js'
import type {ExploreSignInCheck} from './phases/types.js'
import {buildMockProbeResult} from './probeMockResult.js'
import type {ProbeInfoJsonCache} from './ProbeInfoJsonCache.js'
import {sabrSkippedClient} from './download/formatLimitSignals.js'
import {defaultVhxTitleFetcher, deriveRecoveredTitle, extractPageTitleMeta, isLikelyParentPage, isVhxEmbedExtractor, isVhxSentinelTitle, patchInfoJsonTitle, smuggledRefererOf, type VhxTitleFetcher} from './vhxTitleRecovery.js'

const logger = log.scope('probe')
const mappingLog: ProbeMappingLog = {info: (message, meta) => logger.info(message, meta), warn: (message, meta) => logger.warn(message, meta)}

type ProbeAttemptName = 'initial' | 'retry'

type PlaylistScopeRequestLog = PlaylistScope['items']

// Who a probe runs as, and whether yt-dlp rejected that identity's cookies on any of its spawns.
interface ProbeRunAs {
	readonly identity: RunIdentity
	cookiesRejected: boolean
}

// Options bag so unit tests can inject a deterministic parent-page fetcher;
// production leaves it undefined and gets the real HTTP fetcher.
export interface ProbeServiceOptions {
	vhxTitleFetcher?: VhxTitleFetcher
	// Absent: probes never escalate to the Explore session.
	exploreGate?: ExploreGate
	// Absent: a check after rejected cookies cannot tell (see afterCookiesRejected).
	exploreSession?: ExploreSignInCheck
}

const EXPLORE_VERIFIED_SIGNED_OUT = 'exploreVerifiedSignedOut'

// Timer-killed probes surface as exit-errors carrying PROBE_TIMEOUT_MESSAGE.
// Matched by literal because the taxonomy has no timeout kind — see YtDlp.ts.
function isProbeTimeoutFailure(result: ProbeAttemptResult): boolean {
	return result.kind === 'failure' && result.error.kind === 'ytdlp' && result.error.error.raw === PROBE_TIMEOUT_MESSAGE
}

export class ProbeService extends EventEmitter {
	// The unkeyed (wizard) probes' controllers, so cancelInFlight() can abort
	// them all at once. probe() registers + deregisters its controller.
	private inFlight = new Set<AbortController>()
	// Keyed probes, apart from the set above: owners that cancel only their own
	// probe (a quick download's placeholder row keys on its queue item id). At
	// most one probe per key; only cancelProbe(ownerKey) aborts one.
	private inFlightByKey = new Map<string, AbortController>()

	private readonly vhxTitleFetcher: VhxTitleFetcher
	private readonly exploreGate: ExploreGate | undefined
	private readonly exploreSession: ExploreSignInCheck | undefined

	constructor(
		private readonly ytDlp: YtDlp,
		private readonly mockMode = false,
		private readonly probeInfoJsonCache?: ProbeInfoJsonCache,
		options?: ProbeServiceOptions
	) {
		super()
		this.vhxTitleFetcher = options?.vhxTitleFetcher ?? defaultVhxTitleFetcher
		this.exploreGate = options?.exploreGate
		this.exploreSession = options?.exploreSession
	}

	// The site itself said the Explore session is signed out, during a signed-in
	// probe whose cookies yt-dlp rejected. The composition root tells the view.
	onExploreVerifiedSignedOut(listener: () => void): () => void {
		this.on(EXPLORE_VERIFIED_SIGNED_OUT, listener)
		return () => this.off(EXPLORE_VERIFIED_SIGNED_OUT, listener)
	}

	// Abort every unkeyed in-flight probe (the wizard's). Renderer calls this when
	// the user changes the wizard URL, navigates away, or otherwise abandons a slow
	// fetch — without it, a stalled YouTube fallback chain (~180s) keeps the UI
	// spinner blocked. A keyed probe belongs to a Downloads placeholder row and is
	// never in this set: only cancelProbe(ownerKey) aborts it.
	cancelInFlight(): void {
		if (this.inFlight.size === 0) return
		logger.info('Cancelling in-flight probes', {count: this.inFlight.size})
		for (const ctrl of this.inFlight) {
			try {
				ctrl.abort()
			} catch {
				/* already aborted */
			}
		}
		this.inFlight.clear()
	}

	// `escalate: false` keeps the probe anonymous even when the Explore session could
	// rescue it — for lookups that must not spend the user's account (title backfill).
	async probe(url: string, opts: {playlistMode?: ProbePlaylistMode; playlistScope?: PlaylistScope; ownerKey?: string; timeoutMs?: number; escalate?: boolean} = {}): Promise<Result<ProbeResult, ProbeError>> {
		const {playlistMode = 'auto', playlistScope, ownerKey, timeoutMs, escalate = true} = opts
		// At most one escalation per probe; a signed-in failure is the answer.
		let auth: JobAuth | undefined

		const controller = new AbortController()
		if (ownerKey) {
			// At most one live probe per owner: a duplicate probe supersedes the
			// in-flight one. Without this, the old controller becomes unreachable
			// through cancelProbe(ownerKey) and keeps running untracked.
			this.inFlightByKey.get(ownerKey)?.abort()
			this.inFlightByKey.set(ownerKey, controller)
		} else {
			this.inFlight.add(controller)
		}
		try {
			if (this.mockMode) return ok(buildMockProbeResult(url))

			const logContext = {playlistMode, playlistScope: playlistScopeRequestForLog(playlistScope)}
			logger.info('Probe started', {url, ...logContext})

			let cookiesRejected = false
			const runAs = async (identity: RunIdentity): Promise<ProbeOutcome> => {
				const as: ProbeRunAs = {identity, cookiesRejected: false}
				const mappedOutcome = mapProbeAttempt(await this.probeWithRedirectFollow(url, playlistMode, playlistScope, controller.signal, as, timeoutMs), url, logContext, mappingLog)
				cookiesRejected = as.cookiesRejected
				return mappedOutcome
			}
			// Whether a playlist's items need the account too (R20): main decides and stamps them.
			let itemsNeedAccount = false
			let outcome = await runAs('configured')
			const reason = escalate && outcome.kind === 'failure' ? await this.escalationFor(url, outcome.error, controller.signal) : null
			if (reason) {
				logger.info('Probe escalated to the Explore session', {url})
				auth = 'exploreSession'
				itemsNeedAccount = reachesPlaylistItems(reason)
				outcome = await runAs('exploreSession')
				if (cookiesRejected) outcome = await this.afterCookiesRejected(url, outcome, () => runAs('exploreSession'), controller.signal)
			}
			if (outcome.kind === 'failure') return fail(outcome.error)

			let mapped: ProbeResult
			if (outcome.kind === 'playlist') {
				// A bot-walled playlist was only enumerated signed in; its items start anonymous.
				mapped = auth && itemsNeedAccount ? {...outcome.result, entries: outcome.result.entries.map(entry => ({...entry, auth}))} : outcome.result
			} else {
				const {final, video} = outcome
				let result = outcome.result
				// VHX (Vimeo OTT) embeds surface the literal 'Untitled' sentinel and
				// yt-dlp's GenericIE merge keeps the embed's fields over the parent
				// page's, so the real page title is lost. Recover it from the parent
				// page's curated preview title (og:title / twitter:title). Any miss
				// keeps the sentinel — the download proceeds exactly as before.
				let rawForCache = final.raw
				if (isVhxSentinelTitle(result.title) && isVhxEmbedExtractor(result.extractor, result.extractorKey)) {
					const parentUrl = smuggledRefererOf(video.webpage_url) ?? (isLikelyParentPage(url) ? url : null)
					if (parentUrl) {
						let recovered: string | null = null
						try {
							const html = await this.vhxTitleFetcher(parentUrl, controller.signal)
							if (!controller.signal.aborted) recovered = html === null ? null : deriveRecoveredTitle(extractPageTitleMeta(html), parentUrl)
						} catch {
							// Fetcher failure is non-fatal — the sentinel title stays.
						}
						if (recovered && recovered !== result.title) {
							result = {...result, title: recovered}
							rawForCache = patchInfoJsonTitle(final.raw, recovered)
							logger.info('Recovered VHX title from parent page', {url, parentUrl, title: recovered})
						}
					}
				}
				// A signed-in result whose cookies yt-dlp dropped ran anonymously: its info-json is never replayed as signed in.
				const probeInfoJsonRef =
					playlistMode === 'video' && !(auth && cookiesRejected)
						? await this.probeInfoJsonCache?.write(rawForCache, {videoId: typeof video.id === 'string' ? video.id : null, ...(final.stderr.split(/\r?\n/).some(line => sabrSkippedClient(line) !== null) ? {formatsWithheld: true} : {}), ...(auth ? {auth} : {})})
						: undefined
				if (probeInfoJsonRef) {
					const probeInfoJsonPath = await this.probeInfoJsonCache?.resolve(probeInfoJsonRef)
					logger.info('Probe info-json cached', {url, videoId: probeInfoJsonRef.videoId ?? null, probeInfoJsonRef, probeInfoJsonPath: probeInfoJsonPath ?? null})
					result = {...result, probeInfoJsonRef}
				}
				mapped = result
			}
			if (auth) mapped = {...mapped, auth}

			logger.info('Probe result', {...summarizeProbeResult(mapped), playlistMode, playlistScope: playlistScopeRequestForLog(playlistScope)})
			return ok(mapped)
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown probing error'
			logger.error('Probe failure', {message, url, playlistMode, playlistScope: playlistScopeRequestForLog(playlistScope)})
			return fail<ProbeResult, ProbeError>({kind: 'other', code: controller.signal.aborted ? 'cancelled' : 'unknown', message})
		} finally {
			this.inFlight.delete(controller)
			if (ownerKey && this.inFlightByKey.get(ownerKey) === controller) this.inFlightByKey.delete(ownerKey)
		}
	}

	// Why an account would fix this failure, while the user is signed in to
	// Explore; null otherwise. A gate that cannot answer counts as "no": the
	// anonymous failure stands.
	private async escalationFor(url: string, error: ProbeError, signal: AbortSignal): Promise<EscalationReason | null> {
		const reason = escalationReason({stage: 'probe', url, error})
		if (signal.aborted || !this.exploreGate || reason === null) return null
		try {
			return (await this.exploreGate.canEscalate(siteForUrl(url).id)) ? reason : null
		} catch (err) {
			logger.warn('Explore escalation check failed', {url, error: err instanceof Error ? err.message : String(err)})
			return null
		}
	}

	// yt-dlp dropped the session's cookies as rotated or signed out, whatever the
	// exit status. One page load tells which: still signed in → one retry with a
	// fresh jar; signed out → the view is told and the probe fails signed out,
	// never as an anonymous result; a check that cannot tell → a failure becomes
	// a retryable one, a success is kept.
	private async afterCookiesRejected(url: string, outcome: ProbeOutcome, retry: () => Promise<ProbeOutcome>, signal: AbortSignal): Promise<ProbeOutcome> {
		const state: ExploreSignInState = this.exploreSession ? await this.exploreSession.verifySignedIn(siteForUrl(url).id) : 'unknown'
		if (signal.aborted) return PROBE_CANCELLED
		logger.info('yt-dlp rejected the Explore cookies on a signed-in probe', {url, state})
		if (state === 'signedIn') return retry()
		if (state === 'signedOut') {
			this.emit(EXPLORE_VERIFIED_SIGNED_OUT)
			return {kind: 'failure', error: {kind: 'ytdlp', error: {kind: 'loginRequired', raw: 'Signed out of the Explore session'}}}
		}
		return outcome.kind === 'failure' ? {kind: 'failure', error: {kind: 'ytdlp', error: {kind: 'network', raw: 'Could not confirm the Explore session'}}} : outcome
	}

	// Abort one keyed probe without touching any other in-flight probe. Used by
	// the probing-queue-item path: cancelling a Downloads row must not kill the
	// wizard's probe, and cancelInFlight never reaches a keyed one. Unknown keys
	// are a no-op.
	cancelProbe(ownerKey: string): void {
		const controller = this.inFlightByKey.get(ownerKey)
		if (!controller) return
		this.inFlightByKey.delete(ownerKey)
		try {
			controller.abort()
		} catch {
			/* already aborted */
		}
	}

	// Loop over `_type: 'url' / 'url_transparent'` redirects up to depth 1 to
	// follow extractor redirects (e.g. Bandcamp track → resolved video). Anything
	// deeper is a misbehaving extractor — bail rather than loop.
	private async probeWithRedirectFollow(url: string, playlistMode: ProbePlaylistMode, playlistScope: PlaylistScope | undefined, signal: AbortSignal, as: ProbeRunAs, timeoutMs?: number): Promise<ProbeAttemptResult> {
		let currentUrl = url
		for (let depth = 0; depth <= 1; depth++) {
			if (signal.aborted) return PROBE_CANCELLED
			const attempt = await this.runProbeWithDegradationRetry(currentUrl, playlistMode, playlistScope, signal, as, timeoutMs)
			if (attempt.kind === 'failure') return attempt
			const info = attempt.data.info
			if (!isUrlRedirect(info)) return attempt
			const next = info.url
			if (!next || next === currentUrl) return attempt
			logger.info('Probe redirect', {from: currentUrl, to: next, depth, playlistMode, playlistScope: playlistScopeRequestForLog(playlistScope)})
			currentUrl = next
		}
		// Fell through both attempts; return whatever we got — caller surfaces as
		// 'redirected too many times' if still a url_redirect.
		return this.runProbeWithDegradationRetry(currentUrl, playlistMode, playlistScope, signal, as, timeoutMs)
	}

	private async runProbeWithDegradationRetry(url: string, playlistMode: ProbePlaylistMode, playlistScope: PlaylistScope | undefined, signal: AbortSignal, as: ProbeRunAs, timeoutMs?: number): Promise<ProbeAttemptResult> {
		let initial = await this.runProbeAttempt(url, 'initial', playlistMode, playlistScope, signal, as, timeoutMs)
		// A timed-out probe usually means a slow link, not a dead one: the very
		// next attempt often succeeds (observed repeatedly on throttled routes).
		// Exactly one retry — a second timeout is reported as the failure.
		if (initial.kind === 'failure' && isProbeTimeoutFailure(initial) && !signal.aborted) {
			logger.info('Probe timed out — retrying once', {url, playlistMode, playlistScope: playlistScopeRequestForLog(playlistScope)})
			const retry = await this.runProbeAttempt(url, 'retry', playlistMode, playlistScope, signal, as, timeoutMs)
			if (retry.kind === 'failure') {
				logger.info('Probe timeout retry failed; reporting failure', {url, playlistMode, playlistScope: playlistScopeRequestForLog(playlistScope)})
				return retry
			}
			initial = retry
		}
		if (initial.kind === 'failure') return initial
		if (initial.data.degradationSignals.length === 0) return initial
		if (signal.aborted) return initial

		logger.info('Probe degraded-success — retrying', {url, degradationSignals: initial.data.degradationSignals})

		const retry = await this.runProbeAttempt(url, 'retry', playlistMode, playlistScope, signal, as)
		if (retry.kind === 'failure') {
			logger.info('Probe retry failed; using initial degraded result', {url, playlistMode, playlistScope: playlistScopeRequestForLog(playlistScope)})
			return initial
		}
		if (retry.data.degradationSignals.length === 0) return retry

		// Both degraded — pick the one with more formats (only meaningful for video info).
		const initialFormatCount = formatCount(initial.data.info)
		const retryFormatCount = formatCount(retry.data.info)
		return retryFormatCount > initialFormatCount ? retry : initial
	}

	private async runProbeAttempt(url: string, attempt: ProbeAttemptName, playlistMode: ProbePlaylistMode, playlistScope: PlaylistScope | undefined, signal: AbortSignal, as: ProbeRunAs, timeoutMs?: number): Promise<ProbeAttemptResult> {
		const source = attempt === 'retry' ? 'yt-dlp-probe-retry' : 'yt-dlp-probe'
		const youtubePlayerClient = playlistMode === 'video' && siteForUrl(url).id === 'youtube' ? [...YOUTUBE_SINGLE_VIDEO_PLAYER_CLIENTS] : undefined
		const extractor = youtubePlayerClient ? {youtube: {playerClient: youtubePlayerClient}} : undefined
		let stdoutRemainder = ''
		const consumeStdout = (chunk: string): void => {
			const parts = `${stdoutRemainder}${chunk}`.split(/\r?\n/)
			stdoutRemainder = parts.pop() ?? ''
			for (const line of parts) {
				const progress = parseProbeProgressLine(line)
				if (progress) {
					this.emit('progress', {url, playlistMode, ...progress, at: nowIso()} satisfies ProbeProgressEvent)
				}
			}
		}
		const result = await this.ytDlp.run(
			{kind: 'probe', url, selection: {playlistMode, ...(playlistScope ? {playlistScope} : {})}, ...(extractor ? {extractor} : {})},
			{
				abortSignal: signal,
				timeoutMs,
				onStdout: consumeStdout,
				onStderr: chunk => {
					for (const line of splitStderrLines(chunk)) {
						logger.info(line, {source})
					}
				}
			},
			{identity: as.identity}
		)
		if (result.accountCookiesRejected === true) as.cookiesRejected = true

		if (result.kind !== 'success') {
			const code = result.kind === 'exit-error' ? result.exitCode : null
			const rawError = result.kind === 'exit-error' ? result.rawError : result.error.message
			// Distinguish caller-driven cancellation from a genuine yt-dlp failure
			// so the UI doesn't treat it as an error.
			if (signal.aborted || rawError === 'Cancelled') {
				return PROBE_CANCELLED
			}
			// yt-dlp's exit-error kind is anchored to its stderr classifier; for
			// probe-time failures we additionally recognize 'unsupportedUrl' which
			// yt-dlp emits before extraction begins.
			const probeKind = classifyProbeFailure(rawError ?? '')
			logger.error('yt-dlp probe failed', {attempt, code, url, kind: probeKind, playlistMode, playlistScope: playlistScopeRequestForLog(playlistScope)})
			return {kind: 'failure', error: {kind: 'ytdlp', error: {kind: probeKind, raw: rawError ?? 'Probing failed'}} satisfies ProbeError}
		}

		let raw: unknown
		try {
			raw = parseProbeJsonOutput(result.stdout)
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown JSON parse error'
			logger.error('Probe JSON parse failed', {attempt, message, url})
			return {kind: 'failure', error: {kind: 'other', code: 'parse', message: 'Failed to parse probe output', details: message} satisfies ProbeError}
		}

		const parseResult = infoDictSchema.safeParse(raw)
		if (!parseResult.success) {
			const message = parseResult.error.issues[0]?.message ?? 'yt-dlp output failed schema validation'
			logger.error('Probe schema validation failed', {attempt, message, url})
			return {kind: 'failure', error: {kind: 'other', code: 'schema', message: 'Unexpected yt-dlp output shape', details: message} satisfies ProbeError}
		}

		const info = parseResult.data
		const degradationSignals = detectProbeDegradationSignals(result.stderr)
		logger.info('Probe complete', {
			attempt,
			url,
			playlistMode,
			playlistScope: playlistScopeRequestForLog(playlistScope),
			type: info._type ?? 'video',
			title: (info as VideoInfo).title,
			extractor: (info as VideoInfo).extractor,
			degradationSignals: degradationSignals.length > 0 ? degradationSignals.map(s => s.label) : undefined
		})
		return {kind: 'success', data: {info, raw, stderr: result.stderr, degradationSignals}}
	}
}

function formatCount(info: InfoDict): number {
	if (isPlaylistLike(info)) return info.entries.length
	const v = info as VideoInfo
	return v.formats?.length ?? 0
}

function playlistScopeRequestForLog(scope: PlaylistScope | undefined): PlaylistScopeRequestLog {
	return scope?.items ?? {kind: 'app-limit'}
}

// Compact, log-friendly summary of a ProbeResult. Intentionally drops large
// fields (full formats array, full subtitle map) and keeps the shapes a human
// scanning logs would care about: kind, extractor, counts, degradation flags.
function summarizeProbeResult(r: ProbeResult): Record<string, unknown> {
	if (r.kind === 'video') {
		return {
			kind: r.kind,
			extractor: r.extractor,
			extractorKey: r.extractorKey,
			webpageUrl: r.webpageUrl,
			isAudioOnlySource: r.isAudioOnlySource,
			title: r.title,
			duration: r.duration,
			formatCount: r.formats.length,
			formatIds: r.formats.map(f => f.formatId),
			subtitleLangs: Object.keys(r.subtitles ?? {}),
			autoCaptionLangs: Object.keys(r.automaticCaptions ?? {}),
			isLive: r.isLive,
			hasDrm: r.hasDrm,
			availability: r.availability,
			ageLimit: r.ageLimit,
			degraded: r.degraded?.reasons ?? null,
			thumbnail: r.thumbnail || null
		}
	}
	return {kind: r.kind, extractor: r.extractor, extractorKey: r.extractorKey, webpageUrl: r.webpageUrl, isAudioOnlySource: r.isAudioOnlySource, isMultiVideo: r.isMultiVideo, playlistId: r.playlistId, playlistTitle: r.playlistTitle, entryCount: r.entries.length, firstEntryUrl: r.entries[0]?.url ?? null}
}
