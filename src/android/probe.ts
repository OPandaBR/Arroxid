// Probe on the Android shell: run the planned `--dump-single-json` probe through
// the native shell, then read the output with the same mapping Electron main
// uses. Follows a URL redirect a bounded number of times, like ProbeService.

import {fail, ok, type Result} from '@shared/result.js'
import type {CommonSettings, ProbeError, ProbeInput, ProbeResult} from '@shared/types.js'
import {infoDictSchema, isUrlRedirect} from '@shared/ytdlp/infoDict.js'
import {classifyProbeFailure, detectProbeDegradationSignals, mapProbeAttempt, parseProbeJsonOutput, PROBE_CANCELLED, type ProbeAttemptResult} from '@shared/ytdlp/probeMapping.js'
import type {AndroidNativePort} from './nativePort.js'
import {probeArgs} from './ytDlpArgs.js'

const MAX_REDIRECTS = 3

async function probeOnce(native: AndroidNativePort, runId: string, input: ProbeInput, common: CommonSettings): Promise<ProbeAttemptResult> {
	const run = await native.runYtDlp(runId, probeArgs(input, common))
	if (run.cancelled) return PROBE_CANCELLED
	if (run.exitCode !== 0) {
		const raw = run.stderr.trim() || `yt-dlp exited with code ${run.exitCode}`
		return {kind: 'failure', error: {kind: 'ytdlp', error: {kind: classifyProbeFailure(raw), raw}}}
	}
	let raw: unknown
	try {
		raw = parseProbeJsonOutput(run.stdout)
	} catch (error) {
		return {kind: 'failure', error: {kind: 'other', code: 'parse', message: error instanceof Error ? error.message : String(error)}}
	}
	const parsed = infoDictSchema.safeParse(raw)
	if (!parsed.success) return {kind: 'failure', error: {kind: 'other', code: 'schema', message: parsed.error.message}}
	return {kind: 'success', data: {info: parsed.data, raw, stderr: run.stderr, degradationSignals: detectProbeDegradationSignals(run.stderr)}}
}

export async function probeOnAndroid(native: AndroidNativePort, runId: string, input: ProbeInput, common: CommonSettings): Promise<Result<ProbeResult, ProbeError>> {
	let url = input.url
	let attempt = await probeOnce(native, runId, input, common)
	for (let depth = 0; depth < MAX_REDIRECTS && attempt.kind === 'success' && isUrlRedirect(attempt.data.info); depth++) {
		const next = attempt.data.info.url
		if (!next || next === url) break
		url = next
		attempt = await probeOnce(native, runId, {...input, url}, common)
	}
	const outcome = mapProbeAttempt(attempt, url, {shell: 'android'})
	return outcome.kind === 'failure' ? fail(outcome.error) : ok(outcome.result)
}
