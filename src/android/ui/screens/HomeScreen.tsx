import {ArrowLeft, ArrowRight, AudioLines, CheckCircle2, Circle, ClipboardPaste, Film, Gauge, ListVideo, RotateCw, Share2, Sparkles, TriangleAlert, X} from 'lucide-react'
import {useContext, type ReactNode} from 'react'
import {AppApiContext} from '../appApiContext.js'
import type {PlaylistProbeResult, ProbeError, VideoProbeResult} from '@shared/types.js'
import {activeQuality, QUALITY_CHOICES, type QualityChoiceId} from '../downloadPlan.js'
import {formatDuration, hostOf} from '../format.js'
import {errorMessageKey, QUALITY_KEYS, t, type MessageKey} from '../i18n.js'
import {LogoMark} from '../Logo.js'
import {Button, Card, IconButton, ProgressBar} from '../primitives.js'
import {cx} from '../cx.js'
import {useShell} from '../shellContext.js'

const QUALITY_ICONS: Record<QualityChoiceId, ReactNode> = {best: <Sparkles size={20} />, p1080: <Film size={20} />, p720: <Film size={20} />, p480: <Gauge size={20} />, audio: <AudioLines size={20} />}

function LinkField(): ReactNode {
	const draftUrl = useShell(state => state.draftUrl)
	const setDraftUrl = useShell(state => state.setDraftUrl)
	const lookUp = useShell(state => state.lookUp)
	const pasteFromClipboard = useShell(state => state.pasteFromClipboard)

	return (
		<form
			className="flex items-center gap-2 rounded-field bg-surface-2 py-1.5 pl-4 pr-1.5 focus-within:ring-2 focus-within:ring-ember"
			onSubmit={event => {
				event.preventDefault()
				if (draftUrl.trim()) void lookUp(draftUrl)
			}}
		>
			<input
				type="url"
				inputMode="url"
				autoComplete="off"
				enterKeyHint="go"
				aria-label={t('home.placeholder')}
				placeholder={t('home.placeholder')}
				value={draftUrl}
				onChange={event => setDraftUrl(event.target.value)}
				className="min-h-11 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
				data-testid="link-input"
			/>
			{draftUrl ? (
				<IconButton label={t('home.go')} type="submit" className="bg-ember text-on-ember active:bg-ember-strong" data-testid="link-go">
					<ArrowRight size={20} />
				</IconButton>
			) : (
				<Button tone="tonal" className="min-h-11 px-4" onClick={() => void pasteFromClipboard()} data-testid="link-paste">
					<ClipboardPaste size={18} />
					{t('home.paste')}
				</Button>
			)}
		</form>
	)
}

// The desktop clipboard watch's suggestion: a link copied elsewhere, one tap away.
function ClipboardSuggestion(): ReactNode {
	const link = useShell(state => state.clipboardLink)
	const applyLink = useShell(state => state.useClipboardLink)
	const dismiss = useShell(state => state.dismissClipboardLink)
	if (!link) return null
	return (
		<Card className="flex items-center gap-3 p-3 pl-4 animate-slide-up" testId="clipboard-suggestion">
			<span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-ember-soft text-ember">
				<ClipboardPaste size={20} />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-[14px] font-medium text-ink">{t('home.clipboardTitle')}</p>
				<p className="truncate text-[13px] text-muted">{link.replace(/^https?:\/\/(www\.)?/, '')}</p>
			</div>
			<Button className="min-h-10 px-4" onClick={() => void applyLink()} data-testid="clipboard-use">
				{t('home.clipboardUse')}
			</Button>
			<IconButton label={t('home.clear')} onClick={dismiss}>
				<X size={18} />
			</IconButton>
		</Card>
	)
}

function UpdateNotice(): ReactNode {
	const update = useShell(state => state.update)
	const api = useContext(AppApiContext)
	if (!update) return null
	return (
		<button type="button" onClick={() => void api?.shell.openExternal(update.url)} className="flex items-center gap-3 rounded-card bg-moss-soft p-4 text-left text-moss">
			<Sparkles size={18} className="shrink-0" />
			<span className="flex-1 text-sm font-medium">{t('settings.update', {version: update.version})}</span>
			<span className="text-sm font-semibold">{t('settings.updateGet')}</span>
		</button>
	)
}

function IdleHome(): ReactNode {
	return (
		<div className="flex flex-col gap-5 px-5 animate-slide-up">
			<div className="flex flex-col items-start gap-4 pt-4">
				<LogoMark size={56} />
				<div>
					<h1 className="text-[30px] font-semibold leading-tight tracking-tight text-ink">{t('home.title')}</h1>
					<p className="mt-1.5 text-[15px] text-muted">{t('home.subtitle')}</p>
				</div>
			</div>
			<LinkField />
			<ClipboardSuggestion />
			<UpdateNotice />
			<div className="flex items-start gap-3 rounded-card border border-dashed border-line p-4 text-sm text-muted">
				<Share2 size={18} className="mt-0.5 shrink-0 text-ember" />
				<p>{t('home.shareTip')}</p>
			</div>
		</div>
	)
}

function BackRow(): ReactNode {
	const back = useShell(state => state.back)
	return (
		<div className="flex items-center gap-1 px-2 pt-2">
			<IconButton label={t('home.back')} onClick={() => back()}>
				<ArrowLeft size={22} />
			</IconButton>
		</div>
	)
}

function ProbingHome({url}: {url: string}): ReactNode {
	const resetHome = useShell(state => state.resetHome)
	return (
		<div className="flex flex-col gap-4 px-5 pt-4 animate-slide-up">
			<Card className="overflow-hidden">
				<div className="aspect-video animate-pulse-soft bg-surface-2" />
				<div className="flex flex-col gap-3 p-5">
					<p className="font-medium text-ink">{t('home.probing')}</p>
					<p className="truncate text-sm text-muted">{url}</p>
					<ProgressBar percent={0} indeterminate />
				</div>
			</Card>
			<Button tone="text" onClick={() => resetHome()}>
				<X size={18} />
				{t('action.cancel')}
			</Button>
		</div>
	)
}

function QualityList(): ReactNode {
	const settings = useShell(state => state.settings)
	const setQuality = useShell(state => state.setQuality)
	if (!settings) return null
	const current = activeQuality(settings)
	return (
		<div className="flex flex-col gap-2" role="radiogroup" aria-label={t('home.quality')}>
			{QUALITY_CHOICES.map(choice => {
				const selected = choice.id === current
				return (
					<button
						key={choice.id}
						type="button"
						role="radio"
						aria-checked={selected}
						onClick={() => void setQuality(choice.id)}
						className={cx('flex min-h-16 items-center gap-4 rounded-field px-4 text-left transition-colors', selected ? 'bg-ember-soft text-on-ember-soft' : 'bg-surface-2 text-ink')}
						data-testid={`quality-${choice.id}`}
					>
						<span className={cx('shrink-0', selected ? 'text-ember' : 'text-muted')}>{QUALITY_ICONS[choice.id]}</span>
						<span className="min-w-0 flex-1">
							<span className="block text-[15px] font-medium">{t(QUALITY_KEYS[choice.id].label)}</span>
							<span className={cx('block text-[13px]', selected ? 'opacity-80' : 'text-muted')}>{t(QUALITY_KEYS[choice.id].hint)}</span>
						</span>
						{selected ? <CheckCircle2 size={22} className="shrink-0 text-ember" /> : <Circle size={22} className="shrink-0 text-line" />}
					</button>
				)
			})}
		</div>
	)
}

function DownloadBar({label, disabled}: {label: string; disabled?: boolean}): ReactNode {
	const downloadCurrent = useShell(state => state.downloadCurrent)
	return (
		<div className="sticky bottom-0 bg-gradient-to-t from-paper via-paper to-transparent px-5 pb-4 pt-6">
			<Button className="w-full" disabled={disabled} onClick={() => void downloadCurrent()} data-testid="download-button">
				{label}
			</Button>
		</div>
	)
}

function VideoHome({probe}: {probe: VideoProbeResult}): ReactNode {
	const facts = [probe.uploader, formatDuration(probe.duration), hostOf(probe.webpageUrl)].filter(Boolean).join(' · ')
	return (
		<div className="flex flex-col animate-slide-up">
			<BackRow />
			<div className="flex flex-col gap-5 px-5">
				<Card className="overflow-hidden">
					{probe.thumbnail ? (
						<img src={probe.thumbnail} alt="" className="aspect-video w-full bg-surface-2 object-cover" />
					) : (
						<div className="flex aspect-video items-center justify-center bg-ember-soft text-ember">
							<Film size={44} strokeWidth={1.5} />
						</div>
					)}
					<div className="p-5">
						<h2 className="line-clamp-3 text-lg font-semibold leading-snug text-ink">{probe.title}</h2>
						<p className="mt-1 text-sm text-muted">{facts}</p>
					</div>
				</Card>
				{probe.isLive ? (
					<p className="flex items-center gap-2 rounded-field bg-amber-soft p-4 text-sm text-amber">
						<TriangleAlert size={18} />
						{t('home.live')}
					</p>
				) : (
					<div>
						<h3 className="mb-2 px-1 text-sm font-medium text-muted">{t('home.quality')}</h3>
						<QualityList />
					</div>
				)}
			</div>
			<DownloadBar label={t('home.download')} disabled={probe.isLive} />
		</div>
	)
}

function PlaylistHome({probe, selected}: {probe: PlaylistProbeResult; selected: ReadonlySet<string>}): ReactNode {
	const toggleEntry = useShell(state => state.toggleEntry)
	const selectAllEntries = useShell(state => state.selectAllEntries)
	const rows = probe.entries.filter(entry => entry.isContainer !== true)
	const allSelected = selected.size === rows.length
	return (
		<div className="flex flex-col animate-slide-up">
			<BackRow />
			<div className="flex flex-col gap-5 px-5">
				<Card className="flex items-center gap-4 p-5">
					<span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ember-soft text-ember">
						<ListVideo size={24} />
					</span>
					<div className="min-w-0">
						<h2 className="line-clamp-2 text-lg font-semibold leading-snug text-ink">{probe.playlistTitle}</h2>
						<p className="text-sm text-muted">{t('home.playlistCount', {count: rows.length})}</p>
					</div>
				</Card>
				<div>
					<h3 className="mb-2 px-1 text-sm font-medium text-muted">{t('home.quality')}</h3>
					<QualityList />
				</div>
				<div>
					<div className="mb-1 flex items-center justify-between px-1">
						<h3 className="text-sm font-medium text-muted">{t('home.playlistCount', {count: selected.size})}</h3>
						<Button tone="text" className="min-h-10 px-3 text-sm" onClick={() => selectAllEntries(!allSelected)}>
							{allSelected ? t('home.selectNone') : t('home.selectAll')}
						</Button>
					</div>
					<ul className="flex flex-col gap-1">
						{rows.map(entry => {
							const checked = selected.has(entry.id)
							return (
								<li key={entry.id}>
									<button type="button" role="checkbox" aria-checked={checked} onClick={() => toggleEntry(entry.id)} className="flex w-full items-center gap-3 rounded-field p-2 text-left active:bg-surface-2">
										{entry.thumbnail ? <img src={entry.thumbnail} alt="" loading="lazy" className="aspect-video w-24 shrink-0 rounded-xl bg-surface-2 object-cover" /> : <span className="aspect-video w-24 shrink-0 rounded-xl bg-surface-2" />}
										<span className="min-w-0 flex-1">
											<span className="line-clamp-2 text-[14px] font-medium text-ink">{entry.title}</span>
											<span className="text-[12px] text-muted">{formatDuration(entry.duration) ?? `#${entry.playlistIndex}`}</span>
										</span>
										{checked ? <CheckCircle2 size={22} className="shrink-0 text-ember" /> : <Circle size={22} className="shrink-0 text-line" />}
									</button>
								</li>
							)
						})}
					</ul>
				</div>
			</div>
			<DownloadBar label={t('home.downloadMany', {count: selected.size})} disabled={selected.size === 0} />
		</div>
	)
}

function probeErrorText(error: ProbeError): {message: string; details: string | null} {
	if (error.kind === 'ytdlp') return {message: t(errorMessageKey(error.error.kind)), details: error.error.raw}
	const byCode: Partial<Record<typeof error.code, MessageKey>> = {playlist_empty: 'error.playlistEmpty', no_formats: 'error.noFormats', invalid_url: 'error.invalidUrl'}
	const key = byCode[error.code]
	return {message: key ? t(key) : t('error.generic'), details: key ? null : error.message}
}

function FailedHome({url, error}: {url: string; error: ProbeError}): ReactNode {
	const lookUp = useShell(state => state.lookUp)
	const {message, details} = probeErrorText(error)
	return (
		<div className="flex flex-col animate-slide-up">
			<BackRow />
			<div className="flex flex-col gap-4 px-5">
				<Card className="flex flex-col items-start gap-3 p-6">
					<span className="flex size-12 items-center justify-center rounded-2xl bg-alarm-soft text-alarm">
						<TriangleAlert size={24} />
					</span>
					<h2 className="text-lg font-semibold text-ink">{t('error.title')}</h2>
					<p className="text-[15px] text-ink">{message}</p>
					<p className="w-full truncate text-sm text-muted">{url}</p>
					{details ? (
						<details className="w-full text-sm text-muted">
							<summary className="py-1">{t('error.details')}</summary>
							<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-2 p-3 font-mono text-[12px]">{details}</pre>
						</details>
					) : null}
				</Card>
				<Button onClick={() => void lookUp(url)}>
					<RotateCw size={18} />
					{t('error.retry')}
				</Button>
			</div>
		</div>
	)
}

export function HomeScreen(): ReactNode {
	const home = useShell(state => state.home)
	switch (home.kind) {
		case 'idle':
			return <IdleHome />
		case 'probing':
			return <ProbingHome url={home.url} />
		case 'video':
			return <VideoHome probe={home.probe} />
		case 'playlist':
			return <PlaylistHome probe={home.probe} selected={home.selected} />
		case 'failed':
			return <FailedHome url={home.url} error={home.error} />
	}
}
