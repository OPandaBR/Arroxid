// The Android shell port: what the WebView side needs from the native shell
// (the Kotlin `ArroxyNative` Capacitor plugin). Everything the plugin returns
// crosses a trust boundary, so each reply is parsed into a named type here
// before the queue or the probe sees it.

import {z} from 'zod'

export interface NativeInfo {
	// Absolute app-private directory where yt-dlp writes; never user-visible.
	workDir: string
	// Where finished files land, as the user sees it (e.g. `Download/Arroxy`).
	publicDir: string
	ytDlpVersion: string | null
}

export interface YtDlpUpdate {
	updated: boolean
	ytDlpVersion: string | null
}

export interface YtDlpRun {
	exitCode: number
	stdout: string
	stderr: string
	cancelled: boolean
}

export interface PublishedFile {
	name: string
	relativePath: string
	sizeBytes: number
}

export interface AndroidNativePort {
	prepare(): Promise<NativeInfo>
	updateYtDlp(): Promise<YtDlpUpdate>
	// Resolves when the process exits; never rejects for a non-zero exit.
	// Without `onLine` stdout is only returned at the end (a probe's JSON is
	// one huge line not worth streaming across the bridge).
	runYtDlp(runId: string, args: readonly string[], onLine?: (line: string) => void): Promise<YtDlpRun>
	cancelRun(runId: string): Promise<void>
	// Moves every file under `dir` into the public download folder.
	publish(dir: string): Promise<PublishedFile[]>
	removeDir(dir: string): Promise<void>
	openDownloads(): Promise<void>
	openExternal(url: string): Promise<void>
}

const nativeInfoSchema = z.object({workDir: z.string().min(1), publicDir: z.string().min(1), ytDlpVersion: z.string().nullable()})
const ytDlpUpdateSchema = z.object({updated: z.boolean(), ytDlpVersion: z.string().nullable()})
const ytDlpRunSchema = z.object({exitCode: z.number().int(), stdout: z.string(), stderr: z.string(), cancelled: z.boolean()})
const publishSchema = z.object({files: z.array(z.object({name: z.string().min(1), relativePath: z.string().min(1), sizeBytes: z.number().int().nonnegative()}))})
const runLineSchema = z.object({runId: z.string(), line: z.string()})

export function parseNativeInfo(raw: unknown): NativeInfo {
	return nativeInfoSchema.parse(raw)
}

export function parseYtDlpUpdate(raw: unknown): YtDlpUpdate {
	return ytDlpUpdateSchema.parse(raw)
}

export function parseYtDlpRun(raw: unknown): YtDlpRun {
	return ytDlpRunSchema.parse(raw)
}

export function parsePublished(raw: unknown): PublishedFile[] {
	return publishSchema.parse(raw).files
}

export function parseRunLine(raw: unknown): {runId: string; line: string} | null {
	const parsed = runLineSchema.safeParse(raw)
	return parsed.success ? parsed.data : null
}
