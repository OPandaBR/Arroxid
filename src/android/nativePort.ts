// The Android shell port: what the WebView side needs from the native side
// (the Java `ArroxyNative` Capacitor plugin). Everything the plugin returns
// crosses a trust boundary, so each reply is parsed into a named type here
// before the queue, the probe or the UI sees it.

import {z} from 'zod'

export interface NativeInfo {
	// Absolute app-private directory where yt-dlp writes; never user-visible.
	workDir: string
	// Where finished files land, as the user sees it (e.g. `Download/Pingo`).
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

const launchSchema = z.discriminatedUnion('kind', [
	// A share from another app; `quick` came through the "Download now" target.
	z.object({kind: z.literal('share'), text: z.string(), quick: z.boolean()}),
	// Launcher shortcut "Paste link".
	z.object({kind: z.literal('paste')}),
	// Launcher shortcut "Downloads", or a tap on the progress notification.
	z.object({kind: z.literal('downloads')})
])

// How the app was entered.
export type Launch = z.infer<typeof launchSchema>

export interface ClipboardRead {
	// Null when nothing new was copied since the given time, or it holds no text.
	text: string | null
	// When the current clip was copied (ms), -1 when unknown.
	copiedAt: number
}

// The ongoing notification while downloads run; percent < 0 is indeterminate.
export interface ProgressNotice {
	title: string
	text: string
	percent: number
	paused: boolean
	actionLabel: string | null
}

// One finished or failed download; tapping it opens `relativePath` when given.
export interface ResultNotice {
	id: number
	title: string
	text: string
	relativePath?: string
}

const notificationActionSchema = z.object({action: z.enum(['pauseAll', 'resumeAll'])})
export type NotificationAction = z.infer<typeof notificationActionSchema>['action']

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
	// Opens one published file (its `relativePath`) in the app the user picks.
	openFile(relativePath: string): Promise<void>
	// The system share sheet, for a published file or for text.
	shareFile(relativePath: string): Promise<void>
	shareText(text: string): Promise<void>
	openExternal(url: string): Promise<void>
	// How the app was last entered (share, shortcut, notification), handed out once.
	takeLaunch(): Promise<Launch | null>
	// Fires when the app is entered again while running; take it with takeLaunch().
	onLaunch(listener: () => void): () => void
	readClipboard(since: number): Promise<ClipboardRead>
	// Back to the app the user came from.
	moveToBackground(): Promise<void>
	// Android 13+ asks once; true when notifications may be shown.
	requestNotifications(): Promise<boolean>
	setProgressNotice(notice: ProgressNotice | null): Promise<void>
	showResult(notice: ResultNotice): Promise<void>
	onNotificationAction(listener: (action: NotificationAction) => void): () => void
	// The system file picker; the chosen cookies.txt is copied privately. Null when cancelled.
	pickCookiesFile(): Promise<string | null>
	removeCookiesFile(): Promise<void>
}

const nativeInfoSchema = z.object({workDir: z.string().min(1), publicDir: z.string().min(1), ytDlpVersion: z.string().nullable()})
const ytDlpUpdateSchema = z.object({updated: z.boolean(), ytDlpVersion: z.string().nullable()})
const ytDlpRunSchema = z.object({exitCode: z.number().int(), stdout: z.string(), stderr: z.string(), cancelled: z.boolean()})
const publishSchema = z.object({files: z.array(z.object({name: z.string().min(1), relativePath: z.string().min(1), sizeBytes: z.number().int().nonnegative()}))})
const runLineSchema = z.object({runId: z.string(), line: z.string()})
const takeLaunchSchema = z.object({launch: launchSchema.nullable()})
const clipboardSchema = z.object({text: z.string().nullable(), copiedAt: z.number()})
const grantedSchema = z.object({granted: z.boolean()})
const pickedSchema = z.object({path: z.string().min(1).nullable()})

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

export function parseLaunch(raw: unknown): Launch | null {
	return takeLaunchSchema.parse(raw).launch
}

export function parseClipboard(raw: unknown): ClipboardRead {
	return clipboardSchema.parse(raw)
}

export function parseGranted(raw: unknown): boolean {
	return grantedSchema.parse(raw).granted
}

export function parsePicked(raw: unknown): string | null {
	return pickedSchema.parse(raw).path
}

export function parseRunLine(raw: unknown): {runId: string; line: string} | null {
	const parsed = runLineSchema.safeParse(raw)
	return parsed.success ? parsed.data : null
}

export function parseNotificationAction(raw: unknown): NotificationAction | null {
	const parsed = notificationActionSchema.safeParse(raw)
	return parsed.success ? parsed.data.action : null
}
