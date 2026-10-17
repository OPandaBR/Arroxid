// Android composition root: wires core (the AppApi over the native port) to
// the Android interface. The desktop renderer is not part of this app.

import {createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {Capacitor, SystemBars, SystemBarsStyle} from '@capacitor/core'
import {createCapacitorAdapter} from './capacitorAdapter.js'
import {createAndroidAppApi} from './createAndroidAppApi.js'
import {localStorageStore} from './storage.js'
import {Root} from './ui/Root.js'
import {pickUiLang, setUiLang} from './ui/i18n.js'
import {createShellStore} from './ui/store.js'
import './ui/styles.css'

declare const __APP_VERSION__: string

const native = createCapacitorAdapter()
const api = createAndroidAppApi({native, store: localStorageStore(), publicDir: 'Download/Arroxy'})
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

const store = createShellStore(api, {takeSharedText: () => native.takeSharedText(), onShareArrived: listener => native.onShareArrived(listener), openFile: relativePath => native.openFile(relativePath), setDarkSystemBars})

const root = document.getElementById('root')
if (root) createRoot(root).render(createElement(Root, {store, api, setDarkSystemBars}))
