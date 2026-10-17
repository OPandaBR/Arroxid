// AndroidNativePort backed by the `ArroxyNative` Capacitor plugin
// (android/app/src/main/java/com/arroxy/app/ArroxyNativePlugin.java).

import {registerPlugin, type PluginListenerHandle} from '@capacitor/core'
import {parseClipboard, parseGranted, parseLaunch, parseNativeInfo, parseNotificationAction, parsePicked, parsePublished, parseRunLine, parseYtDlpRun, parseYtDlpUpdate, type AndroidNativePort, type NotificationAction, type ProgressNotice, type ResultNotice} from './nativePort.js'

// Raw plugin surface: every reply is `unknown` until nativePort.ts parses it.
interface ArroxyNativePlugin {
	prepare(): Promise<unknown>
	updateYtDlp(): Promise<unknown>
	run(input: {runId: string; args: string[]; streamLines: boolean}): Promise<unknown>
	cancel(input: {runId: string}): Promise<unknown>
	publish(input: {dir: string}): Promise<unknown>
	removeDir(input: {dir: string}): Promise<unknown>
	openDownloads(): Promise<unknown>
	openFile(input: {relativePath: string}): Promise<unknown>
	shareFile(input: {relativePath: string}): Promise<unknown>
	shareText(input: {text: string}): Promise<unknown>
	openExternal(input: {url: string}): Promise<unknown>
	takeLaunch(): Promise<unknown>
	readClipboard(input: {since: number}): Promise<unknown>
	moveToBackground(): Promise<unknown>
	requestNotifications(): Promise<unknown>
	setProgressNotice(input: {notice: ProgressNotice | null}): Promise<unknown>
	showResult(input: ResultNotice): Promise<unknown>
	pickCookiesFile(): Promise<unknown>
	removeCookiesFile(): Promise<unknown>
	addListener(eventName: 'runLine' | 'launch' | 'notificationAction', listener: (event: unknown) => void): Promise<PluginListenerHandle>
}

function listeners<T>(): {add: (listener: (value: T) => void) => () => void; emit: (value: T) => void} {
	const set = new Set<(value: T) => void>()
	return {
		add: listener => {
			set.add(listener)
			return () => set.delete(listener)
		},
		emit: value => set.forEach(listener => listener(value))
	}
}

export function createCapacitorAdapter(): AndroidNativePort {
	const plugin = registerPlugin<ArroxyNativePlugin>('ArroxyNative')
	const lineListeners = new Map<string, (line: string) => void>()
	void plugin.addListener('runLine', event => {
		const parsed = parseRunLine(event)
		if (parsed) lineListeners.get(parsed.runId)?.(parsed.line)
	})
	const launches = listeners<undefined>()
	void plugin.addListener('launch', () => launches.emit(undefined))
	const notificationActions = listeners<NotificationAction>()
	void plugin.addListener('notificationAction', event => {
		const action = parseNotificationAction(event)
		if (action) notificationActions.emit(action)
	})

	return {
		prepare: async () => parseNativeInfo(await plugin.prepare()),
		updateYtDlp: async () => parseYtDlpUpdate(await plugin.updateYtDlp()),
		runYtDlp: async (runId, args, onLine) => {
			if (onLine) lineListeners.set(runId, onLine)
			try {
				return parseYtDlpRun(await plugin.run({runId, args: [...args], streamLines: onLine !== undefined}))
			} finally {
				lineListeners.delete(runId)
			}
		},
		cancelRun: async runId => {
			await plugin.cancel({runId})
		},
		publish: async dir => parsePublished(await plugin.publish({dir})),
		removeDir: async dir => {
			await plugin.removeDir({dir})
		},
		openDownloads: async () => {
			await plugin.openDownloads()
		},
		openFile: async relativePath => {
			await plugin.openFile({relativePath})
		},
		shareFile: async relativePath => {
			await plugin.shareFile({relativePath})
		},
		shareText: async text => {
			await plugin.shareText({text})
		},
		openExternal: async url => {
			await plugin.openExternal({url})
		},
		takeLaunch: async () => parseLaunch(await plugin.takeLaunch()),
		onLaunch: listener => launches.add(() => listener()),
		readClipboard: async since => parseClipboard(await plugin.readClipboard({since})),
		moveToBackground: async () => {
			await plugin.moveToBackground()
		},
		requestNotifications: async () => parseGranted(await plugin.requestNotifications()),
		setProgressNotice: async notice => {
			await plugin.setProgressNotice({notice})
		},
		showResult: async notice => {
			await plugin.showResult(notice)
		},
		onNotificationAction: listener => notificationActions.add(listener),
		pickCookiesFile: async () => parsePicked(await plugin.pickCookiesFile()),
		removeCookiesFile: async () => {
			await plugin.removeCookiesFile()
		}
	}
}
