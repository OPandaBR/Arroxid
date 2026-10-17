// State of the Android interface. It talks to core only through the AppApi
// (the same contract the desktop renderer uses) plus the phone's own
// integrations in AndroidUiShell (share targets, clipboard, share sheet…).

import {createStore, type StoreApi} from 'zustand/vanilla'
import type {AppApi, SettingsPatch} from '@shared/api.js'
import {WEBSITE_URL} from '@shared/constants.js'
import {QUEUE_STATUS} from '@shared/schemas.js'
import type {AppSettings, CommonSettings, PlaylistProbeResult, ProbeError, QueueItem, VideoProbeResult} from '@shared/types.js'
import type {AndroidNativePort, Launch} from '../nativePort.js'
import type {AndroidUpdate} from '../updateCheck.js'
import {activeQuality, linkFromSharedText, planQueueItems, profileRefFor, type QualityChoiceId} from './downloadPlan.js'
import {QUALITY_KEYS, errorMessageKey, t} from './i18n.js'

export type ShellNative = Pick<AndroidNativePort, 'takeLaunch' | 'onLaunch' | 'readClipboard' | 'moveToBackground' | 'openFile' | 'shareFile' | 'shareText' | 'requestNotifications' | 'showResult' | 'pickCookiesFile' | 'removeCookiesFile'>

export interface AndroidUiShell {
	native: ShellNative
	checkForUpdate: () => Promise<AndroidUpdate | null>
	// When the last clipboard link was seen, kept across launches so a clip is offered once.
	clipboardSeenAt: {get: () => number; set: (copiedAt: number) => void}
}

export type Tab = 'home' | 'downloads' | 'settings'

export type HomeState = {kind: 'idle'} | {kind: 'probing'; url: string} | {kind: 'video'; url: string; probe: VideoProbeResult} | {kind: 'playlist'; url: string; probe: PlaylistProbeResult; selected: ReadonlySet<string>} | {kind: 'failed'; url: string; error: ProbeError}

export type BootState = {kind: 'starting'} | {kind: 'ready'; ytDlpVersion: string | null} | {kind: 'failed'; message: string}

export interface Toast {
	id: number
	message: string
	action?: {label: string; tab: Tab}
}

export interface ShellState {
	boot: BootState
	settings: AppSettings | null
	items: QueueItem[]
	schedulerPaused: boolean
	tab: Tab
	draftUrl: string
	home: HomeState
	toast: Toast | null
	// A link the user copied in another app, offered on the Download screen.
	clipboardLink: string | null
	update: AndroidUpdate | null
}

export interface ShellActions {
	start: () => Promise<void>
	setTab: (tab: Tab) => void
	back: () => boolean
	setDraftUrl: (url: string) => void
	lookUp: (text: string) => Promise<void>
	resetHome: () => void
	toggleEntry: (entryId: string) => void
	selectAllEntries: (selected: boolean) => void
	setQuality: (quality: QualityChoiceId) => Promise<void>
	downloadCurrent: (opts?: {quick?: boolean}) => Promise<number>
	updateCommon: (patch: Partial<CommonSettings>) => Promise<boolean>
	openArtifact: (item: QueueItem) => Promise<void>
	shareArtifact: (item: QueueItem) => Promise<void>
	shareFailure: (item: QueueItem) => Promise<void>
	shareApp: () => Promise<void>
	checkClipboard: () => Promise<void>
	useClipboardLink: () => Promise<void>
	dismissClipboardLink: () => void
	pasteFromClipboard: () => Promise<void>
	chooseCookies: () => Promise<void>
	clearCookies: () => Promise<void>
	dismissToast: () => void
}

export type ShellStore = StoreApi<ShellState & ShellActions>

function mediaArtifact(item: QueueItem): QueueItem['artifacts'][number] | undefined {
	return item.artifacts.find(artifact => artifact.kind === 'media') ?? item.artifacts[0]
}

function playlistRows(probe: PlaylistProbeResult): string[] {
	return probe.entries.filter(entry => entry.isContainer !== true).map(entry => entry.id)
}

export function createShellStore(api: AppApi, shell: AndroidUiShell, newId: () => string = () => crypto.randomUUID()): ShellStore {
	const {native} = shell
	let toastSeq = 0
	let probeSeq = 0
	let askedNotifications = false

	return createStore<ShellState & ShellActions>()((set, get) => {
		const showToast = (message: string, action?: Toast['action']): void => {
			toastSeq += 1
			set({toast: {id: toastSeq, message, ...(action ? {action} : {})}})
		}

		const upsert = (item: QueueItem): void => {
			const items = get().items
			const index = items.findIndex(entry => entry.id === item.id)
			set({items: index < 0 ? [...items, item] : items.map(entry => (entry.id === item.id ? item : entry))})
		}

		const applySettings = async (patch: SettingsPatch): Promise<boolean> => {
			const result = await api.settings.update(patch)
			if (result.ok) set({settings: result.data})
			return result.ok
		}

		// A share through "Download now" queues with the active quality and goes
		// back to the app it came from, like the desktop hotkey. A playlist still
		// opens for review: picking rows is not something to guess.
		const handleLaunch = async (launch: Launch): Promise<void> => {
			if (launch.kind === 'downloads') {
				set({tab: 'downloads'})
				return
			}
			set({tab: 'home', clipboardLink: null})
			if (launch.kind === 'paste') {
				await get().pasteFromClipboard()
				return
			}
			await get().lookUp(launch.text)
			const home = get().home
			if (!launch.quick || home.kind !== 'video') return
			const title = home.probe.title
			if ((await get().downloadCurrent({quick: true})) > 0) {
				void native.showResult({id: 1, title: t('notice.quickQueued', {title}), text: t('home.quickTip')})
				await native.moveToBackground()
			}
		}

		const takeLaunch = async (): Promise<boolean> => {
			const launch = await native.takeLaunch()
			if (launch) await handleLaunch(launch)
			return launch !== null
		}

		return {
			boot: {kind: 'starting'},
			settings: null,
			items: [],
			schedulerPaused: false,
			tab: 'home',
			draftUrl: '',
			home: {kind: 'idle'},
			toast: null,
			clipboardLink: null,
			update: null,

			start: async () => {
				set({boot: {kind: 'starting'}})
				const settings = await api.settings.get()
				if (settings.ok) set({settings: settings.data})
				const warm = await api.app.warmUp()
				if (!warm.ok || !warm.data.completed) {
					set({boot: {kind: 'failed', message: warm.ok ? warm.data.blockingFailures.join(', ') : warm.error.message}})
					return
				}
				api.queue.events.onAdded(({items}) => items.forEach(upsert))
				api.queue.events.onUpdated(({item}) => upsert(item))
				api.queue.events.onRemoved(({itemId}) => set({items: get().items.filter(item => item.id !== itemId)}))
				api.queue.events.onScheduler(({paused}) => set({schedulerPaused: paused}))
				const snapshot = await api.queue.cmd.getSnapshot()
				if (snapshot.ok) set({items: snapshot.data.items, schedulerPaused: snapshot.data.schedulerPaused})
				set({boot: {kind: 'ready', ytDlpVersion: warm.data.dependencies['yt-dlp'].versionOutput ?? null}})
				native.onLaunch(() => void takeLaunch())
				void shell.checkForUpdate().then(update => set({update}))
				if (!(await takeLaunch())) await get().checkClipboard()
			},

			setTab: tab => set({tab}),

			// Android's back gesture: leave a result, then a secondary tab. False when there is nothing left to undo.
			back: () => {
				const {tab, home} = get()
				if (tab !== 'home') {
					set({tab: 'home'})
					return true
				}
				if (home.kind !== 'idle') {
					get().resetHome()
					return true
				}
				return false
			},

			setDraftUrl: draftUrl => set({draftUrl}),

			lookUp: async text => {
				const url = linkFromSharedText(text.trim())
				if (url === null) {
					set({draftUrl: text, home: {kind: 'failed', url: text, error: {kind: 'other', code: 'invalid_url', message: t('error.invalidUrl')}}})
					return
				}
				probeSeq += 1
				const seq = probeSeq
				set({draftUrl: url, clipboardLink: get().clipboardLink === url ? null : get().clipboardLink, home: {kind: 'probing', url}})
				const result = await api.downloads.probe({url, playlistMode: 'auto'})
				if (seq !== probeSeq) return
				if (!result.ok) {
					set({home: {kind: 'failed', url, error: result.error}})
					return
				}
				const probe = result.data
				set({home: probe.kind === 'video' ? {kind: 'video', url, probe} : {kind: 'playlist', url, probe, selected: new Set(playlistRows(probe))}})
			},

			resetHome: () => {
				probeSeq += 1
				if (get().home.kind === 'probing') void api.downloads.probeCancel()
				set({home: {kind: 'idle'}, draftUrl: ''})
			},

			toggleEntry: entryId => {
				const home = get().home
				if (home.kind !== 'playlist') return
				const selected = new Set(home.selected)
				if (selected.has(entryId)) selected.delete(entryId)
				else selected.add(entryId)
				set({home: {...home, selected}})
			},

			selectAllEntries: selected => {
				const home = get().home
				if (home.kind !== 'playlist') return
				set({home: {...home, selected: new Set(selected ? playlistRows(home.probe) : [])}})
			},

			setQuality: async quality => {
				if (!get().settings) return
				await applySettings({profiles: {active: profileRefFor(quality)}})
			},

			downloadCurrent: async ({quick = false} = {}) => {
				const {home, settings} = get()
				if (!settings || (home.kind !== 'video' && home.kind !== 'playlist')) return 0
				const quality = activeQuality(settings)
				const entries = home.kind === 'playlist' ? home.probe.entries.filter(entry => home.selected.has(entry.id)) : undefined
				const items = planQueueItems({probe: home.probe, quality, settings, entries, formatLabel: t(QUALITY_KEYS[quality].label), now: new Date().toISOString(), newId})
				if (items.length === 0) return 0
				// Android 13+ asks once, at the first download: that is when the progress notice appears.
				if (!askedNotifications) {
					askedNotifications = true
					await native.requestNotifications().catch(() => false)
				}
				const result = await api.queue.cmd.add(items)
				const added = result.ok ? result.data.ids.length : 0
				if (!quick) showToast(added === 0 ? t('home.alreadyQueued') : added === 1 ? t('home.queued') : t('home.queuedMany', {count: added}), {label: t('home.view'), tab: 'downloads'})
				get().resetHome()
				return added
			},

			updateCommon: patch => applySettings({common: patch}),

			openArtifact: async item => {
				const media = mediaArtifact(item)
				if (media) await native.openFile(media.path).catch(() => void api.shell.openFolder())
				else await api.shell.openFolder()
			},

			shareArtifact: async item => {
				const media = mediaArtifact(item)
				if (media) await native.shareFile(media.path).catch(() => showToast(t('error.fileMissing')))
			},

			// The phone's diagnostics: the failure as text, for a chat or an issue report.
			shareFailure: async item => {
				const reason = item.error ? `${t(errorMessageKey(item.error.kind))}\n\n${item.error.raw}` : ''
				await native.shareText(`${item.title}\n${item.url}\n\n${reason}\n\nArroxy ${window.appVersion} (Android)`.trim())
			},

			shareApp: async () => {
				await native.shareText(t('settings.shareMessage', {url: WEBSITE_URL}))
			},

			// The desktop clipboard watch, on Android's terms: only while in front,
			// and only a clip copied since the last look (reading it shows a system toast).
			checkClipboard: async () => {
				const {settings, home, items} = get()
				if (settings?.common.clipboardWatchEnabled === false || home.kind !== 'idle') return
				const read = await native.readClipboard(shell.clipboardSeenAt.get()).catch(() => null)
				if (!read || read.text === null) return
				shell.clipboardSeenAt.set(read.copiedAt)
				const link = linkFromSharedText(read.text)
				if (link && !items.some(item => item.url === link)) set({clipboardLink: link})
			},

			useClipboardLink: async () => {
				const link = get().clipboardLink
				set({clipboardLink: null})
				if (link) await get().lookUp(link)
			},

			dismissClipboardLink: () => set({clipboardLink: null}),

			pasteFromClipboard: async () => {
				const read = await native.readClipboard(-1).catch(() => null)
				const link = read?.text ? linkFromSharedText(read.text) : null
				if (link) await get().lookUp(link)
				else showToast(t('home.nothingCopied'))
			},

			chooseCookies: async () => {
				const path = await native.pickCookiesFile().catch(() => null)
				if (path) await applySettings({common: {cookiesMode: 'file', cookiesPath: path}})
			},

			clearCookies: async () => {
				await native.removeCookiesFile()
				await applySettings({common: {cookiesMode: 'off', cookiesPath: undefined}})
			},

			dismissToast: () => set({toast: null})
		}
	})
}

// Failed rows stay with the active ones: they still need the user.
export function isFinished(item: QueueItem): boolean {
	return item.status === QUEUE_STATUS.done || item.status === QUEUE_STATUS.cancelled
}
