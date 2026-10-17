// Android composition root: install the native-backed AppApi on `window`,
// then boot the unchanged renderer, which finds it like the preload bridge.

import {createCapacitorAdapter} from './capacitorAdapter.js'
import {createAndroidAppApi} from './createAndroidAppApi.js'
import {localStorageStore} from './storage.js'

declare const __APP_VERSION__: string

window.appApi = createAndroidAppApi({native: createCapacitorAdapter(), store: localStorageStore(), publicDir: 'Download/Arroxy'})
window.platform = 'android'
window.appVersion = __APP_VERSION__

await import('../renderer/src/main.js')
