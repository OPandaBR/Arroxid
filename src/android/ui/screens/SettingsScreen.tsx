import {ChevronRight, ExternalLink, FolderOpen, Minus, Plus, Share2, Sparkles} from 'lucide-react'
import {useContext, useState, type ReactNode} from 'react'
import type {UiTheme} from '@shared/schemas.js'
import {MAX_CONCURRENT_DOWNLOADS, NORMAL_LANE_CAP} from '@shared/constants.js'
import {AppApiContext} from '../appApiContext.js'
import {activeQuality, QUALITY_CHOICES} from '../downloadPlan.js'
import {QUALITY_KEYS, t} from '../i18n.js'
import {Button, Card, IconButton, ScreenHeader, Segmented, Switch} from '../primitives.js'
import {cx} from '../cx.js'
import {useShell} from '../shellContext.js'

const SOURCE_URL = 'https://github.com/antonio-orionus/Arroxy'

function Group({title, children}: {title: string; children: ReactNode}): ReactNode {
	return (
		<div className="flex flex-col gap-2">
			<h2 className="px-1 text-sm font-medium text-ember">{title}</h2>
			<Card className="divide-y divide-line">{children}</Card>
		</div>
	)
}

function Row({label, hint, children}: {label: string; hint?: string; children?: ReactNode}): ReactNode {
	return (
		<div className="flex min-h-16 items-center gap-3 px-5 py-3">
			<div className="min-w-0 flex-1">
				<p className="text-[15px] text-ink">{label}</p>
				{hint ? <p className="mt-0.5 text-[13px] text-muted wrap-anywhere">{hint}</p> : null}
			</div>
			{children}
		</div>
	)
}

// A free-text setting saved when the field loses focus; the store rejects what the schema does not accept.
function TextSetting({label, hint, value, onSave}: {label: string; hint: string; value: string; onSave: (value: string) => Promise<boolean>}): ReactNode {
	const [draft, setDraft] = useState(value)
	const [state, setState] = useState<'idle' | 'saved' | 'invalid'>('idle')
	return (
		<label className="flex flex-col gap-2 px-5 py-4">
			<span className="text-[15px] text-ink">{label}</span>
			<input
				value={draft}
				onChange={event => {
					setDraft(event.target.value)
					setState('idle')
				}}
				onBlur={() => {
					if (draft.trim() === value) return
					void onSave(draft.trim()).then(ok => setState(ok ? 'saved' : 'invalid'))
				}}
				autoCapitalize="off"
				autoCorrect="off"
				spellCheck={false}
				className={cx('min-h-12 rounded-field bg-surface-2 px-4 text-[15px] text-ink outline-none focus:ring-2 focus:ring-ember', state === 'invalid' && 'ring-2 ring-alarm')}
			/>
			<span className={cx('text-[13px]', state === 'invalid' ? 'text-alarm' : state === 'saved' ? 'text-moss' : 'text-muted')}>{state === 'invalid' ? t('settings.invalid') : state === 'saved' ? t('settings.saved') : hint}</span>
		</label>
	)
}

export function SettingsScreen(): ReactNode {
	const api = useContext(AppApiContext)
	const settings = useShell(state => state.settings)
	const boot = useShell(state => state.boot)
	const updateCommon = useShell(state => state.updateCommon)
	const setQuality = useShell(state => state.setQuality)
	const chooseCookies = useShell(state => state.chooseCookies)
	const clearCookies = useShell(state => state.clearCookies)
	const shareApp = useShell(state => state.shareApp)
	const update = useShell(state => state.update)
	if (!settings) return null
	const cookiesLoaded = settings.common.cookiesMode === 'file' && Boolean(settings.common.cookiesPath)
	const common = settings.common
	const parallel = common.concurrentDownloads ?? NORMAL_LANE_CAP
	const quality = activeQuality(settings)
	const cycleQuality = (): void => {
		const index = QUALITY_CHOICES.findIndex(choice => choice.id === quality)
		const next = QUALITY_CHOICES[(index + 1) % QUALITY_CHOICES.length]
		if (next) void setQuality(next.id)
	}
	return (
		<div className="flex flex-col animate-slide-up">
			<ScreenHeader title={t('settings.title')} />
			<div className="flex flex-col gap-6 px-5 pb-8">
				<Group title={t('settings.appearance')}>
					<div className="flex flex-col gap-3 px-5 py-4">
						<p className="text-[15px] text-ink">{t('settings.theme')}</p>
						<Segmented<UiTheme>
							label={t('settings.theme')}
							value={common.uiTheme ?? 'system'}
							onChange={uiTheme => void updateCommon({uiTheme})}
							options={[
								{value: 'system', label: t('settings.theme.system')},
								{value: 'light', label: t('settings.theme.light')},
								{value: 'dark', label: t('settings.theme.dark')}
							]}
						/>
					</div>
				</Group>

				<Group title={t('settings.downloads')}>
					<button type="button" onClick={cycleQuality} className="flex w-full items-center text-left active:bg-surface-2">
						<Row label={t('settings.quality')} hint={t(QUALITY_KEYS[quality].label)}>
							<ChevronRight size={20} className="text-muted" />
						</Row>
					</button>
					<Row label={t('settings.parallel')}>
						<div className="flex items-center gap-1 rounded-full bg-surface-2">
							<IconButton label="−" disabled={parallel <= 1} onClick={() => void updateCommon({concurrentDownloads: parallel - 1})}>
								<Minus size={18} />
							</IconButton>
							<span className="w-6 text-center text-[15px] font-medium tabular-nums text-ink">{parallel}</span>
							<IconButton label="+" disabled={parallel >= MAX_CONCURRENT_DOWNLOADS} onClick={() => void updateCommon({concurrentDownloads: parallel + 1})}>
								<Plus size={18} />
							</IconButton>
						</div>
					</Row>
					<Row label={t('settings.clipboard')} hint={t('settings.clipboard.hint')}>
						<Switch label={t('settings.clipboard')} checked={common.clipboardWatchEnabled !== false} onChange={clipboardWatchEnabled => void updateCommon({clipboardWatchEnabled})} />
					</Row>
					<TextSetting label={t('settings.rate')} hint={t('settings.rate.hint')} value={common.limitRate ?? ''} onSave={limitRate => updateCommon({limitRate: limitRate || undefined})} />
					<TextSetting label={t('settings.proxy')} hint={t('settings.proxy.hint')} value={common.proxyUrl ?? ''} onSave={proxyUrl => updateCommon({proxyUrl: proxyUrl || undefined})} />
				</Group>

				<Group title={t('settings.access')}>
					<Row label={t('settings.cookies')} hint={t('settings.cookies.hint')} />
					<Row label={cookiesLoaded ? t('settings.cookies.loaded') : t('settings.cookies.none')}>
						{cookiesLoaded ? (
							<Button tone="text" className="min-h-10 px-4" onClick={() => void clearCookies()}>
								{t('settings.cookies.remove')}
							</Button>
						) : null}
						<Button tone="tonal" className="min-h-10 px-4" onClick={() => void chooseCookies()} data-testid="cookies-choose">
							{t('settings.cookies.choose')}
						</Button>
					</Row>
				</Group>

				<Group title={t('settings.storage')}>
					<Row label={t('settings.folder')} hint={common.defaultOutputDir}>
						<IconButton label={t('downloads.openFolder')} onClick={() => void api?.shell.openFolder()}>
							<FolderOpen size={20} />
						</IconButton>
					</Row>
				</Group>

				<Group title={t('settings.about')}>
					{update ? (
						<button type="button" onClick={() => void api?.shell.openExternal(update.url)} className="flex w-full items-center text-left active:bg-surface-2">
							<Row label={t('settings.update', {version: update.version})}>
								<Sparkles size={18} className="text-moss" />
							</Row>
						</button>
					) : null}
					<Row label={t('settings.version')} hint={window.appVersion} />
					<Row label={t('settings.engine')} hint={boot.kind === 'ready' ? (boot.ytDlpVersion ?? '—') : '—'} />
					<button type="button" onClick={() => void api?.shell.openExternal(SOURCE_URL)} className="flex w-full items-center text-left active:bg-surface-2">
						<Row label={t('settings.source')} hint={`${t('settings.basedOn')} · ${SOURCE_URL.replace('https://', '')}`}>
							<ExternalLink size={18} className="text-muted" />
						</Row>
					</button>
					<button type="button" onClick={() => void shareApp()} className="flex w-full items-center text-left active:bg-surface-2">
						<Row label={t('settings.share')}>
							<Share2 size={18} className="text-muted" />
						</Row>
					</button>
				</Group>
			</div>
		</div>
	)
}
