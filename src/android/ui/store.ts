// State of the Android interface. It talks to core only through the AppApi
// (the same contract the desktop renderer uses) plus the few phone-only
// capabilities in AndroidUiShell.

import {createStore, type StoreApi} from 'zustand/vanilla'
import type {AppApi, SettingsPatch} from '@shared/api.js'
import {QUEUE_STATUS} from '@shared/schemas.js'
import type {AppSettings, CommonSettings, PlaylistProbeResult, ProbeError, QueueItem, VideoProbeResult} from '@shared/types.js'
import {activeQuality, linkFromSharedText, planQueueItems, profileRefFor, type QualityChoiceId} from './downloadPlan.js'
import {QUALITY_KEYS, t} from './i18n.js'

export interface AndroidUiShell {
	takeSharedText: () => Promise<string | null>
	onShareArrived: (listener: () => void) => () => void
	openFile: (relativePath: string) => Promise<void>
	setDarkSystemBars: (dark: boolean) => void
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
	downloadCurrent: () => Promise<void>
	updateCommon: (patch: Partial<CommonSettings>) => Promise<boolean>
	openArtifact: (item: QueueItem) => Promise<void>
	dismissToast: () => void
}

export type ShellStore = StoreApi<ShellState & ShellActions>

export function createShellStore(api: AppApi, shell: AndroidUiShell, newId: () => string = () => crypto.randomUUID()): ShellStore {
	let toastSeq = 0
	let probeSeq = 0

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

		const takeShare = async (): Promise<void> => {
			const text = await shell.takeSharedText()
			if (text === null) return
			set({tab: 'home'})
			await get().lookUp(text)
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
				shell.onShareArrived(() => void takeShare())
				await takeShare()
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
				set({draftUrl: url, home: {kind: 'probing', url}})
				const result = await api.downloads.probe({url, playlistMode: 'auto'})
				if (seq !== probeSeq) return
				if (!result.ok) {
					set({home: {kind: 'failed', url, error: result.error}})
					return
				}
				const probe = result.data
				set({home: probe.kind === 'video' ? {kind: 'video', url, probe} : {kind: 'playlist', url, probe, selected: new Set(probe.entries.filter(entry => entry.isContainer !== true).map(entry => entry.id))}})
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
				set({home: {...home, selected: new Set(selected ? home.probe.entries.filter(entry => entry.isContainer !== true).map(entry => entry.id) : [])}})
			},

			setQuality: async quality => {
				const settings = get().settings
				if (!settings) return
				await applySettings({profiles: {active: profileRefFor(quality)}})
			},

			downloadCurrent: async () => {
				const {home, settings} = get()
				if (!settings || (home.kind !== 'video' && home.kind !== 'playlist')) return
				const quality = activeQuality(settings)
				const entries = home.kind === 'playlist' ? home.probe.entries.filter(entry => home.selected.has(entry.id)) : undefined
				const items = planQueueItems({probe: home.probe, quality, settings, entries, formatLabel: t(QUALITY_KEYS[quality].label), now: new Date().toISOString(), newId})
				if (items.length === 0) return
				const result = await api.queue.cmd.add(items)
				if (!result.ok) {
					showToast(t('home.alreadyQueued'), {label: t('home.view'), tab: 'downloads'})
					return
				}
				const added = result.data.ids.length
				showToast(added === 0 ? t('home.alreadyQueued') : added === 1 ? t('home.queued') : t('home.queuedMany', {count: added}), {label: t('home.view'), tab: 'downloads'})
				get().resetHome()
			},

			updateCommon: patch => applySettings({common: patch}),

			openArtifact: async item => {
				const media = item.artifacts.find(artifact => artifact.kind === 'media') ?? item.artifacts[0]
				if (media) await shell.openFile(media.path).catch(() => void api.shell.openFolder())
				else await api.shell.openFolder()
			},

			dismissToast: () => set({toast: null})
		}
	})
}

// Failed rows stay with the active ones: they still need the user.
export function isFinished(item: QueueItem): boolean {
	return item.status === QUEUE_STATUS.done || item.status === QUEUE_STATUS.cancelled
}
