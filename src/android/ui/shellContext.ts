import {createContext, useContext} from 'react'
import {useStore} from 'zustand'
import type {ShellActions, ShellState, ShellStore} from './store.js'

export const ShellStoreContext = createContext<ShellStore | null>(null)

export function useShell<T>(selector: (state: ShellState & ShellActions) => T): T {
	const store = useContext(ShellStoreContext)
	if (!store) throw new Error('useShell must be used inside ShellStoreContext')
	return useStore(store, selector)
}
