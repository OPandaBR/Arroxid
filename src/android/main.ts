// Android composition root: wires core (the AppApi over the native port) to
// the Android interface. The desktop renderer is not part of this app.

import {createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {Capacitor, SystemBars, SystemBarsStyle} from '@capacitor/core'
import {createCapacitorAdapter} from './capacitorAdapter.js'
import {createAndroidAppApi} from './createAndroidAppApi.js'
import {checkForAndroidUpdate} from './updateCheck.js'
import {localStorageStore} from './storage.js'
import {Root} from './ui/Root.js'
import {pickUiLang, setUiLang} from './ui/i18n.js'
import {watchQueueNotices} from './ui/notices.js'
import {createShellStore} from './ui/store.js'
import './ui/styles.css'

declare const __APP_VERSION__: string

const native = createCapacitorAdapter()
const storage = localStorageStore()
const api = createAndroidAppApi({native, store: storage, publicDir: 'Download/Pingo'})
window.appApi = api
window.platform = 'android'
window.appVersion = __APP_VERSION__

const lang = pickUiLang(navigator.language)
setUiLang(lang)
document.documentElement.lang = lang

// Dark theme → light status-bar icons, and the other way round.
const setDarkSystemBars = (dark: boolean): void => {
	if (Capacitor.isNativePlatform()) void SystemBars.setStyle({style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light}).catch(() => undefined)
}

const CLIPBOARD_SEEN_KEY = 'arroxy:android:clipboardSeenAt'

const store = createShellStore(api, {
	native,
	checkForUpdate: () => checkForAndroidUpdate(__APP_VERSION__, async url => (await fetch(url, {headers: {accept: 'application/vnd.github+json'}})).json()),
	clipboardSeenAt: {get: () => Number(storage.get(CLIPBOARD_SEEN_KEY) ?? -1), set: copiedAt => storage.set(CLIPBOARD_SEEN_KEY, String(copiedAt))}
})

// The shade follows the queue whether or not a screen is open: the phone's tray.
watchQueueNotices(api, native, () => document.visibilityState === 'visible')

const root = document.getElementById('root')
if (root) createRoot(root).render(createElement(Root, {store, api, setDarkSystemBars}))
