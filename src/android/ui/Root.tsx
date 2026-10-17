import {StrictMode, type ReactNode} from 'react'
import type {AppApi} from '@shared/api.js'
import {App} from './App.js'
import {AppApiContext} from './appApiContext.js'
import {ShellStoreContext} from './shellContext.js'
import type {ShellStore} from './store.js'

export function Root({store, api, setDarkSystemBars}: {store: ShellStore; api: AppApi; setDarkSystemBars: (dark: boolean) => void}): ReactNode {
	return (
		<StrictMode>
			<AppApiContext.Provider value={api}>
				<ShellStoreContext.Provider value={store}>
					<App setDarkSystemBars={setDarkSystemBars} />
				</ShellStoreContext.Provider>
			</AppApiContext.Provider>
		</StrictMode>
	)
}
