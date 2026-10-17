// What Arroxy shows in Android's notification shade: the ongoing progress
// notice (the desktop tray's job) and one notice per finished or failed item
// (the desktop's OS notifications). Pure.

import type {AppApi} from '@shared/api.js'
import {QUEUE_STATUS} from '@shared/schemas.js'
import type {QueueItem} from '@shared/types.js'
import type {AndroidNativePort, ProgressNotice, ResultNotice} from '../nativePort.js'
import {progressFacts} from './format.js'
import {errorMessageKey, t} from './i18n.js'

export function progressNotice(items: readonly QueueItem[]): ProgressNotice | null {
	const running = items.filter(item => item.status === QUEUE_STATUS.running)
	if (running.length === 0) return null
	const queued = items.filter(item => item.status === QUEUE_STATUS.pending).length
	const percent = Math.round(running.reduce((sum, item) => sum + item.progressPercent, 0) / running.length)
	const facts = running.length === 1 ? progressFacts(running[0]?.progressDetail ?? null) : {size: null, speed: null, eta: null}
	const text = [`${percent}%`, facts.speed, facts.eta ? t('eta.left', {eta: facts.eta}) : null, queued > 0 ? t('notice.queued', {count: queued}) : null].filter(Boolean).join(' · ')
	return {title: running.length === 1 ? (running[0]?.title ?? '') : t('notice.runningMany', {count: running.length}), text, percent, paused: false, actionLabel: t('downloads.pauseAll')}
}

// Stable small id per item, so a retried item replaces its earlier notice.
function noticeId(itemId: string): number {
	let hash = 0
	for (const char of itemId) hash = (hash * 31 + char.charCodeAt(0)) | 0
	return 1000 + (Math.abs(hash) % 1_000_000)
}

export function resultNotice(before: QueueItem | undefined, after: QueueItem): ResultNotice | null {
	if (before?.status === after.status) return null
	if (after.status === QUEUE_STATUS.done) {
		const media = after.artifacts.find(artifact => artifact.kind === 'media') ?? after.artifacts[0]
		return {id: noticeId(after.id), title: t('notice.saved'), text: after.title, ...(media ? {relativePath: media.path} : {})}
	}
	if (after.status === QUEUE_STATUS.error && after.error) return {id: noticeId(after.id), title: t('notice.failed'), text: `${after.title} — ${t(errorMessageKey(after.error.kind))}`}
	return null
}

const PROGRESS_THROTTLE_MS = 1000

type NoticePort = Pick<AndroidNativePort, 'setProgressNotice' | 'showResult' | 'onNotificationAction'>

// Keeps the notification shade in step with the queue. Result notices only
// show while Arroxy is not in front: in front, the Downloads screen says it.
export function watchQueueNotices(api: AppApi, native: NoticePort, inForeground: () => boolean): void {
	const items = new Map<string, QueueItem>()
	let lastSent = 0
	let timer: ReturnType<typeof setTimeout> | null = null
	const sendProgress = (): void => {
		timer = null
		lastSent = Date.now()
		void native.setProgressNotice(progressNotice([...items.values()]))
	}
	const scheduleProgress = (): void => {
		if (timer !== null) return
		timer = setTimeout(sendProgress, Math.max(0, PROGRESS_THROTTLE_MS - (Date.now() - lastSent)))
	}
	const track = (item: QueueItem): void => {
		const notice = resultNotice(items.get(item.id), item)
		items.set(item.id, item)
		if (notice && !inForeground()) void native.showResult(notice)
		scheduleProgress()
	}
	void api.queue.cmd.getSnapshot().then(result => {
		if (result.ok) for (const item of result.data.items) items.set(item.id, item)
		scheduleProgress()
	})
	api.queue.events.onAdded(({items: added}) => added.forEach(track))
	api.queue.events.onUpdated(({item}) => track(item))
	api.queue.events.onRemoved(({itemId}) => {
		items.delete(itemId)
		scheduleProgress()
	})
	native.onNotificationAction(action => void (action === 'pauseAll' ? api.queue.cmd.pauseAll() : api.queue.cmd.resumeAll()))
}
