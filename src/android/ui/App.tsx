import {Download, Settings2, Sparkles} from 'lucide-react'
import {useEffect, useRef, type ReactNode} from 'react'
import {t} from './i18n.js'
import {cx} from './cx.js'
import {BootScreen} from './screens/BootScreen.js'
import {DownloadsScreen} from './screens/DownloadsScreen.js'
import {HomeScreen} from './screens/HomeScreen.js'
import {SettingsScreen} from './screens/SettingsScreen.js'
import {useShell} from './shellContext.js'
import {isFinished, type Tab} from './store.js'

const TOAST_MS = 4000

function useTheme(setDarkSystemBars: (dark: boolean) => void): void {
	const theme = useShell(state => state.settings?.common.uiTheme ?? 'system')
	useEffect(() => {
		const media = window.matchMedia('(prefers-color-scheme: dark)')
		const apply = (): void => {
			const dark = theme === 'dark' || (theme === 'system' && media.matches)
			document.documentElement.dataset.theme = dark ? 'dark' : 'light'
			document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#15110e' : '#fbf6f1')
			setDarkSystemBars(dark)
		}
		apply()
		media.addEventListener('change', apply)
		return () => media.removeEventListener('change', apply)
	}, [theme, setDarkSystemBars])
}

// Android's back gesture pops WebView history. Every step "into" the app
// pushes an entry, so back walks out the way the user came in.
function useBackNavigation(): void {
	const depth = useShell(state => (state.tab !== 'home' ? 1 : 0) + (state.home.kind !== 'idle' ? 1 : 0))
	const back = useShell(state => state.back)
	const pushed = useRef(0)
	useEffect(() => {
		while (pushed.current < depth) {
			history.pushState({arroxy: pushed.current + 1}, '')
			pushed.current += 1
		}
	}, [depth])
	useEffect(() => {
		const onPop = (): void => {
			pushed.current = Math.max(0, pushed.current - 1)
			back()
		}
		window.addEventListener('popstate', onPop)
		return () => window.removeEventListener('popstate', onPop)
	}, [back])
}

function Snackbar(): ReactNode {
	const toast = useShell(state => state.toast)
	const dismissToast = useShell(state => state.dismissToast)
	const setTab = useShell(state => state.setTab)
	useEffect(() => {
		if (!toast) return
		const timer = window.setTimeout(dismissToast, TOAST_MS)
		return () => window.clearTimeout(timer)
	}, [toast, dismissToast])
	if (!toast) return null
	return (
		<div role="status" className="pointer-events-auto mx-4 mb-3 flex min-h-12 items-center gap-3 rounded-2xl bg-ink py-2 pl-4 pr-2 text-[14px] text-paper shadow-float animate-slide-up" key={toast.id}>
			<span className="flex-1">{toast.message}</span>
			{toast.action ? (
				<button
					type="button"
					className="min-h-10 rounded-full px-3 font-medium text-ember"
					onClick={() => {
						setTab(toast.action?.tab ?? 'downloads')
						dismissToast()
					}}
				>
					{toast.action.label}
				</button>
			) : null}
		</div>
	)
}

const TABS: {tab: Tab; label: () => string; icon: ReactNode}[] = [
	{tab: 'home', label: () => t('tab.download'), icon: <Sparkles size={22} />},
	{tab: 'downloads', label: () => t('tab.downloads'), icon: <Download size={22} />},
	{tab: 'settings', label: () => t('tab.settings'), icon: <Settings2 size={22} />}
]

function NavigationBar(): ReactNode {
	const tab = useShell(state => state.tab)
	const setTab = useShell(state => state.setTab)
	const activeCount = useShell(state => state.items.filter(item => !isFinished(item)).length)
	return (
		<nav className="pb-safe border-t border-line bg-surface" aria-label="Pingo">
			<div className="flex h-20 items-center">
				{TABS.map(entry => {
					const selected = entry.tab === tab
					return (
						<button key={entry.tab} type="button" aria-current={selected ? 'page' : undefined} onClick={() => setTab(entry.tab)} className="flex flex-1 flex-col items-center gap-1" data-testid={`tab-${entry.tab}`}>
							<span className={cx('relative flex h-8 w-16 items-center justify-center rounded-full transition-colors', selected ? 'bg-ember-soft text-on-ember-soft' : 'text-muted')}>
								{entry.icon}
								{entry.tab === 'downloads' && activeCount > 0 ? <span className="absolute -top-1 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-ember px-1 text-[10px] font-semibold text-on-ember">{activeCount}</span> : null}
							</span>
							<span className={cx('text-[12px]', selected ? 'font-semibold text-ink' : 'text-muted')}>{entry.label()}</span>
						</button>
					)
				})}
			</div>
		</nav>
	)
}

export function App({setDarkSystemBars}: {setDarkSystemBars: (dark: boolean) => void}): ReactNode {
	const boot = useShell(state => state.boot)
	const tab = useShell(state => state.tab)
	const start = useShell(state => state.start)
	const mainRef = useRef<HTMLElement>(null)
	useTheme(setDarkSystemBars)
	useBackNavigation()
	useEffect(() => {
		void start()
	}, [start])
	useEffect(() => {
		mainRef.current?.scrollTo({top: 0})
	}, [tab])
	// Coming back to Pingo is the moment the desktop watcher would look at the clipboard.
	const checkClipboard = useShell(state => state.checkClipboard)
	useEffect(() => {
		const onVisible = (): void => {
			if (document.visibilityState === 'visible') void checkClipboard()
		}
		document.addEventListener('visibilitychange', onVisible)
		return () => document.removeEventListener('visibilitychange', onVisible)
	}, [checkClipboard])

	if (boot.kind !== 'ready') return <BootScreen />
	return (
		<div className="flex h-full flex-col">
			<main ref={mainRef} className="pt-safe relative flex-1 overflow-y-auto">
				{tab === 'home' ? <HomeScreen /> : tab === 'downloads' ? <DownloadsScreen /> : <SettingsScreen />}
			</main>
			<div className="pointer-events-none relative">
				<div className="absolute inset-x-0 bottom-0">
					<Snackbar />
				</div>
			</div>
			<NavigationBar />
		</div>
	)
}
