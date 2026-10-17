// Persistence for the Android shell: settings and the queue live in the
// WebView's localStorage (app-private on Android). Both are read back through
// their shared schemas, so a corrupt or outdated entry falls back to defaults
// instead of reaching the queue or the renderer.

import type {SettingsPatch} from '@shared/api.js'
import {fail, ok, type Result} from '@shared/result.js'
import {queueItemSchema} from '@shared/queueItemSchema.js'
import {appSettingsSchema} from '@shared/schemas.js'
import type {AppSettings, QueueItem, QueueSnapshotPayload} from '@shared/types.js'
import type {QueuePersistence} from './queue.js'

export interface KeyValueStore {
	get(key: string): string | null
	set(key: string, value: string): void
}

const SETTINGS_KEY = 'arroxy:android:settings'
const QUEUE_KEY = 'arroxy:android:queue'

function readJson(store: KeyValueStore, key: string): unknown {
	const raw = store.get(key)
	if (raw === null) return null
	try {
		return JSON.parse(raw)
	} catch {
		return null
	}
}

export class AndroidSettingsStore {
	private settings: AppSettings

	constructor(
		private readonly store: KeyValueStore,
		defaults: AppSettings
	) {
		const parsed = appSettingsSchema.safeParse(readJson(store, SETTINGS_KEY))
		this.settings = parsed.success ? parsed.data : defaults
	}

	get(): AppSettings {
		return this.settings
	}

	update(patch: SettingsPatch): Result<AppSettings> {
		const next = {common: {...this.settings.common, ...patch.common}, single: {...this.settings.single, ...patch.single}, playlist: {...this.settings.playlist, ...patch.playlist}, profiles: {...this.settings.profiles, ...patch.profiles}}
		const parsed = appSettingsSchema.safeParse(next)
		if (!parsed.success) return fail({code: 'validation', message: parsed.error.message})
		this.settings = parsed.data
		this.store.set(SETTINGS_KEY, JSON.stringify(parsed.data))
		return ok(parsed.data)
	}
}

export function createQueuePersistence(store: KeyValueStore): QueuePersistence {
	return {
		load: () => {
			const raw = readJson(store, QUEUE_KEY)
			if (typeof raw !== 'object' || raw === null || !('items' in raw) || !Array.isArray(raw.items)) return {items: [], schedulerPaused: false}
			const items = raw.items.flatMap((entry: unknown): QueueItem[] => {
				const parsed = queueItemSchema.safeParse(entry)
				return parsed.success ? [parsed.data] : []
			})
			const schedulerPaused = 'schedulerPaused' in raw && raw.schedulerPaused === true
			return {items, schedulerPaused}
		},
		save: (snapshot: QueueSnapshotPayload) => {
			store.set(QUEUE_KEY, JSON.stringify(snapshot))
		}
	}
}

export function localStorageStore(): KeyValueStore {
	return {
		get: key => {
			try {
				return window.localStorage.getItem(key)
			} catch {
				return null
			}
		},
		set: (key, value) => {
			try {
				window.localStorage.setItem(key, value)
			} catch {
				// Storage full or unavailable: the app keeps working for this session.
			}
		}
	}
}
