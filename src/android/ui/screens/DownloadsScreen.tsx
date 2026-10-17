import {Ban, CheckCircle2, Film, FolderOpen, MoreHorizontal, Pause, Play, RotateCw, Share2, Trash2, TriangleAlert, X} from 'lucide-react'
import {useContext, useState, type ReactNode} from 'react'
import type {AppApi} from '@shared/api.js'
import {QUEUE_STATUS, STATUS_KEY, type QueueItemStatus} from '@shared/schemas.js'
import type {QueueItem} from '@shared/types.js'
import {progressFacts} from '../format.js'
import {errorMessageKey, t, type MessageKey} from '../i18n.js'
import {Card, IconButton, ProgressBar, ScreenHeader, Segmented} from '../primitives.js'
import {cx} from '../cx.js'
import {useShell} from '../shellContext.js'
import {isFinished} from '../store.js'
import {AppApiContext} from '../appApiContext.js'

const STATUS_KEYS: Record<QueueItemStatus, MessageKey> = {
	probing: 'status.probing',
	'needs-choice': 'status.needsChoice',
	pending: 'status.pending',
	running: 'status.running',
	'paused-held': 'status.pausedHeld',
	'paused-active': 'status.pausedActive',
	done: 'status.done',
	error: 'status.error',
	cancelled: 'status.cancelled'
}

function statusLine(item: QueueItem): string {
	if (item.status === QUEUE_STATUS.running) {
		if (item.lastStatus?.key === STATUS_KEY.mergingFormats || item.lastStatus?.key === STATUS_KEY.embeddingMetadata || item.lastStatus?.key === STATUS_KEY.extractingAudio) return t('status.merging')
		if (item.lastStatus?.key === STATUS_KEY.movingFiles) return t('status.saving')
		if (item.lastStatus?.key === STATUS_KEY.sleepingBetweenRequests) return t('status.sleeping')
		if (item.progressDetail === null) return t('status.starting')
		const facts = progressFacts(item.progressDetail)
		return [`${Math.round(item.progressPercent)}%`, facts.size, facts.speed, facts.eta ? t('eta.left', {eta: facts.eta}) : null].filter(Boolean).join(' · ')
	}
	if (item.status === QUEUE_STATUS.done && item.lastStatus?.key === STATUS_KEY.subtitlesFailed) return t('status.subtitlesFailed')
	if (item.status === QUEUE_STATUS.error && item.error) return t(errorMessageKey(item.error.kind))
	return t(STATUS_KEYS[item.status])
}

function StatusIcon({status}: {status: QueueItemStatus}): ReactNode {
	if (status === QUEUE_STATUS.done) return <CheckCircle2 size={16} className="text-moss" />
	if (status === QUEUE_STATUS.error) return <TriangleAlert size={16} className="text-alarm" />
	if (status === QUEUE_STATUS.cancelled) return <Ban size={16} className="text-muted" />
	return null
}

function itemActions(api: AppApi, item: QueueItem): {label: string; icon: ReactNode; run: () => void}[] {
	const id = {itemId: item.id}
	const pause = {label: t('action.pause'), icon: <Pause size={20} />, run: () => void api.queue.cmd.pause(id)}
	const resume = {label: t('action.resume'), icon: <Play size={20} />, run: () => void api.queue.cmd.resume(id)}
	const cancel = {label: t('action.cancel'), icon: <X size={20} />, run: () => void api.queue.cmd.cancel(id)}
	const retry = {label: t('action.retry'), icon: <RotateCw size={20} />, run: () => void api.queue.cmd.retry(id)}
	const remove = {label: t('action.remove'), icon: <Trash2 size={20} />, run: () => void api.queue.cmd.remove(id)}
	switch (item.status) {
		case QUEUE_STATUS.running:
		case QUEUE_STATUS.pending:
			return [pause, cancel]
		case QUEUE_STATUS.pausedActive:
		case QUEUE_STATUS.pausedHeld:
			return [resume, cancel]
		case QUEUE_STATUS.error:
			return item.job.kind === 'unresolved' ? [remove] : [retry, remove]
		case QUEUE_STATUS.cancelled:
			return [retry, remove]
		case QUEUE_STATUS.done:
			return [remove]
		case QUEUE_STATUS.probing:
		case QUEUE_STATUS.needsChoice:
			return [cancel]
	}
}

function DownloadRow({item}: {item: QueueItem}): ReactNode {
	const api = useContext(AppApiContext)
	const openArtifact = useShell(state => state.openArtifact)
	const shareArtifact = useShell(state => state.shareArtifact)
	const shareFailure = useShell(state => state.shareFailure)
	const [menuOpen, setMenuOpen] = useState(false)
	if (!api) return null
	const actions = itemActions(api, item)
	const primary = item.status === QUEUE_STATUS.done ? null : actions[0]
	const active = item.status === QUEUE_STATUS.running || item.status === QUEUE_STATUS.pending || item.status === QUEUE_STATUS.pausedActive || item.status === QUEUE_STATUS.pausedHeld
	return (
		<Card className="overflow-hidden">
			<div className="flex gap-3 p-3" data-testid="download-row" data-status={item.status}>
				<button type="button" disabled={item.status !== QUEUE_STATUS.done} onClick={() => void openArtifact(item)} className="relative shrink-0 overflow-hidden rounded-xl" aria-label={t('action.open')}>
					{item.thumbnail ? (
						<img src={item.thumbnail} alt="" loading="lazy" className="aspect-video w-28 bg-surface-2 object-cover" />
					) : (
						<span className="flex aspect-video w-28 items-center justify-center bg-surface-2 text-muted">
							<Film size={22} />
						</span>
					)}
					{item.status === QUEUE_STATUS.done ? (
						<span className="absolute inset-0 flex items-center justify-center bg-scrim text-white">
							<Play size={22} fill="currentColor" />
						</span>
					) : null}
				</button>
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<p className="line-clamp-2 text-[14px] font-medium leading-snug text-ink">{item.title}</p>
					<p className={cx('flex items-center gap-1.5 text-[12px]', item.status === QUEUE_STATUS.error ? 'text-alarm' : 'text-muted')}>
						<StatusIcon status={item.status} />
						<span className="line-clamp-2">{statusLine(item)}</span>
					</p>
					<p className="truncate text-[12px] text-muted">{item.formatLabel}</p>
				</div>
				<div className="flex shrink-0 flex-col items-center">
					{primary ? (
						<IconButton label={primary.label} onClick={primary.run}>
							{primary.icon}
						</IconButton>
					) : null}
					<IconButton label={t('action.more')} onClick={() => setMenuOpen(open => !open)} aria-expanded={menuOpen}>
						<MoreHorizontal size={20} />
					</IconButton>
				</div>
			</div>
			{active ? (
				<div className="px-3 pb-3">
					<ProgressBar percent={item.progressPercent} indeterminate={item.status === QUEUE_STATUS.pending} tone={item.status === QUEUE_STATUS.running ? 'ember' : 'muted'} />
				</div>
			) : null}
			{menuOpen ? (
				<div className="flex flex-wrap gap-2 border-t border-line px-3 py-2">
					{[
						...(item.status === QUEUE_STATUS.done
							? [
									{label: t('action.open'), icon: <Play size={18} />, run: () => void openArtifact(item)},
									{label: t('action.share'), icon: <Share2 size={18} />, run: () => void shareArtifact(item)}
								]
							: []),
						...(item.status === QUEUE_STATUS.error ? [{label: t('action.shareError'), icon: <Share2 size={18} />, run: () => void shareFailure(item)}] : []),
						...actions
					].map(action => (
						<button
							key={action.label}
							type="button"
							onClick={() => {
								setMenuOpen(false)
								action.run()
							}}
							className="inline-flex min-h-10 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-medium text-ink"
						>
							{action.icon}
							{action.label}
						</button>
					))}
				</div>
			) : null}
		</Card>
	)
}

function EmptyState({text}: {text: string}): ReactNode {
	return (
		<div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
			<svg width="120" height="96" viewBox="0 0 120 96" aria-hidden="true">
				<ellipse cx="60" cy="84" rx="38" ry="6" className="fill-surface-2" />
				<path d="M60 10s-20 24-20 37a20 20 0 0 0 40 0C80 34 60 10 60 10Z" className="fill-ember-soft" />
				<path d="M60 30v24m-9-9 9 9 9-9" className="stroke-ember" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
			</svg>
			<p className="text-[15px] text-muted">{text}</p>
		</div>
	)
}

export function DownloadsScreen(): ReactNode {
	const api = useContext(AppApiContext)
	const items = useShell(state => state.items)
	const schedulerPaused = useShell(state => state.schedulerPaused)
	const [view, setView] = useState<'active' | 'finished'>('active')
	const active = items.filter(item => !isFinished(item))
	const finished = items.filter(isFinished).reverse()
	const shown = view === 'active' ? active : finished
	return (
		<div className="flex flex-col animate-slide-up">
			<ScreenHeader
				title={t('downloads.title')}
				trailing={
					<IconButton label={t('downloads.openFolder')} onClick={() => void api?.shell.openFolder()}>
						<FolderOpen size={22} />
					</IconButton>
				}
			/>
			<div className="flex flex-col gap-4 px-5">
				<Segmented
					label={t('downloads.title')}
					value={view}
					onChange={setView}
					options={[
						{value: 'active', label: `${t('downloads.active')} · ${active.length}`},
						{value: 'finished', label: `${t('downloads.finished')} · ${finished.length}`}
					]}
				/>
				{shown.length > 0 ? (
					<div className="flex justify-end gap-1">
						{view === 'active' ? (
							<button type="button" className="min-h-10 rounded-full px-4 text-sm font-medium text-ember active:bg-ember-soft" onClick={() => void (schedulerPaused ? api?.queue.cmd.resumeAll() : api?.queue.cmd.pauseAll())}>
								{schedulerPaused ? t('downloads.resumeAll') : t('downloads.pauseAll')}
							</button>
						) : (
							<button type="button" className="min-h-10 rounded-full px-4 text-sm font-medium text-ember active:bg-ember-soft" onClick={() => void api?.queue.cmd.clearCompleted()}>
								{t('downloads.clearFinished')}
							</button>
						)}
					</div>
				) : null}
				<div className="flex flex-col gap-3 pb-6">{shown.length === 0 ? <EmptyState text={view === 'active' ? t('downloads.emptyActive') : t('downloads.emptyFinished')} /> : shown.map(item => <DownloadRow key={item.id} item={item} />)}</div>
			</div>
		</div>
	)
}
