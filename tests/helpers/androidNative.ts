import type {AndroidNativePort, NativeInfo} from '../../src/android/nativePort.js'

const INFO: NativeInfo = {workDir: '/data/work', publicDir: 'Download/Pingo', ytDlpVersion: '2026.10.01'}

// An Android native side that does nothing, for tests to override piece by piece.
export function quietNative(overrides: Partial<AndroidNativePort> = {}): AndroidNativePort {
	return {
		prepare: () => Promise.resolve(INFO),
		updateYtDlp: () => Promise.resolve({updated: false, ytDlpVersion: INFO.ytDlpVersion}),
		runYtDlp: () => new Promise(() => undefined),
		cancelRun: () => Promise.resolve(),
		publish: () => Promise.resolve([]),
		removeDir: () => Promise.resolve(),
		openDownloads: () => Promise.resolve(),
		openFile: () => Promise.resolve(),
		shareFile: () => Promise.resolve(),
		shareText: () => Promise.resolve(),
		openExternal: () => Promise.resolve(),
		takeLaunch: () => Promise.resolve(null),
		onLaunch: () => () => undefined,
		readClipboard: () => Promise.resolve({text: null, copiedAt: -1}),
		moveToBackground: () => Promise.resolve(),
		requestNotifications: () => Promise.resolve(true),
		setProgressNotice: () => Promise.resolve(),
		showResult: () => Promise.resolve(),
		onNotificationAction: () => () => undefined,
		pickCookiesFile: () => Promise.resolve(null),
		removeCookiesFile: () => Promise.resolve(),
		...overrides
	}
}
