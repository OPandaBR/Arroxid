import {createContext} from 'react'
import type {AppApi} from '@shared/api.js'

// Screens that only fire commands (queue controls, open folder) reach the AppApi directly.
export const AppApiContext = createContext<AppApi | null>(null)
