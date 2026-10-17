// AndroidNativePort backed by the `ArroxyNative` Capacitor plugin
// (android/app/src/main/java/com/arroxy/app/ArroxyNativePlugin.java).

import {registerPlugin, type PluginListenerHandle} from '@capacitor/core'
import {parseNativeInfo, parsePublished, parseRunLine, parseSharedText, parseYtDlpRun, parseYtDlpUpdate, type AndroidNativePort} from './nativePort.js'

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
	openExternal(input: {url: string}): Promise<unknown>
	takeSharedText(): Promise<unknown>
	addListener(eventName: 'runLine' | 'sharedText', listener: (event: unknown) => void): Promise<PluginListenerHandle>
}

export function createCapacitorAdapter(): AndroidNativePort {
	const plugin = registerPlugin<ArroxyNativePlugin>('ArroxyNative')
	const lineListeners = new Map<string, (line: string) => void>()
	void plugin.addListener('runLine', event => {
		const parsed = parseRunLine(event)
		if (parsed) lineListeners.get(parsed.runId)?.(parsed.line)
	})
	const shareListeners = new Set<() => void>()
	void plugin.addListener('sharedText', () => shareListeners.forEach(listener => listener()))

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
		openExternal: async url => {
			await plugin.openExternal({url})
		},
		takeSharedText: async () => parseSharedText(await plugin.takeSharedText()),
		onShareArrived: listener => {
			shareListeners.add(listener)
			return () => shareListeners.delete(listener)
		}
	}
}
