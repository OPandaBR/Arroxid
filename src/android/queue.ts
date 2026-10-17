// The download queue on the Android shell. Same contract as Electron main's
// QueueService (the renderer cannot tell them apart): status changes go
// through the shared `transition` state machine, admission through the shared
// live-duplicate rule. Each item downloads into its own app-private job
// directory, so a paused item resumes on its `.part` files.

import {MAX_CONCURRENT_DOWNLOADS, NORMAL_LANE_CAP} from '@shared/constants.js'
import {admitAgainstLive, canApplyQueueActionToItem} from '@shared/queueActions.js'
import {illegalTransition, transition, type QueueEvent} from '@shared/queueTransition.js'
import {fail, ok, type Result} from '@shared/result.js'
import {QUEUE_STATUS, STATUS_KEY, type QueueChoice, type QueueLane, type QueueSelectionAction} from '@shared/schemas.js'
import type {CommonSettings, LocalizedError, QueueActionSkippedItem, QueueItem, QueueOutputTargetChangeItemResult, QueueOutputTargetChangeResult, QueueSelectionCommandResult, QueueSnapshotPayload} from '@shared/types.js'
import type {AndroidNativePort} from './nativePort.js'
import {runQueueJob, type ResolvedJob} from './jobRunner.js'

export interface QueuePersistence {
	load(): QueueSnapshotPayload
	save(snapshot: QueueSnapshotPayload): void
}

export interface QueueListeners {
	added(items: QueueItem[], atIdx: number): void
	updated(item: QueueItem): void
	removed(itemId: string): void
	scheduler(paused: boolean): void
}

export interface AndroidQueueDeps {
	native: AndroidNativePort
	persistence: QueuePersistence
	listeners: QueueListeners
	common: () => CommonSettings
	workDir: () => Promise<string>
	now: () => string
	newId: () => string
}

type StopReason = 'pause' | 'cancel'

interface ActiveRun {
	runId: string
	stop: StopReason | null
}

const conflict = (message: string): Result<never> => fail({code: 'conflict', message})
const stale = (message: string): Result<never> => fail({code: 'validation', message})

function isPlaceholder(item: QueueItem): boolean {
	return item.status === QUEUE_STATUS.probing || item.status === QUEUE_STATUS.needsChoice
}

function resolvedJob(item: QueueItem): ResolvedJob | null {
	return item.job.kind === 'unresolved' ? null : item.job
}

// A run interrupted by an app kill restarts; a paused one stays paused.
function restored(item: QueueItem): QueueItem {
	return item.status === QUEUE_STATUS.running ? {...item, status: QUEUE_STATUS.pending, lastJobId: undefined} : item
}

export class AndroidQueue {
	private items: QueueItem[]
	private schedulerPaused: boolean
	private readonly active = new Map<string, ActiveRun>()

	constructor(private readonly deps: AndroidQueueDeps) {
		const snapshot = deps.persistence.load()
		this.items = snapshot.items.map(restored)
		this.schedulerPaused = snapshot.schedulerPaused
	}

	snapshot(): QueueSnapshotPayload {
		return {items: [...this.items], schedulerPaused: this.schedulerPaused}
	}

	// Call once the native side is ready so restored pending items start.
	kick(): void {
		this.pump()
	}

	add(toAdd: QueueItem[]): Result<{ids: string[]; skippedAlreadyQueued: number}> {
		const admission = admitAgainstLive(toAdd, this.items)
		if (!admission.ok) return conflict(`queue item URL is already active: ${admission.duplicate.url}`)
		this.insert(admission.admitted, this.items.length)
		return ok({ids: admission.admitted.map(item => item.id), skippedAlreadyQueued: admission.skippedAlreadyQueued})
	}

	replaceProbing(itemId: string, items: QueueItem[]): Result<{ids: string[]; skippedAlreadyQueued: number}> {
		const placeholder = this.find(itemId)
		if (!placeholder || !isPlaceholder(placeholder)) return stale('probing placeholder is no longer active')
		const atIdx = this.items.indexOf(placeholder)
		this.removeItem(itemId)
		const admission = admitAgainstLive(items, this.items)
		if (!admission.ok) return conflict(`queue item URL is already active: ${admission.duplicate.url}`)
		this.insert(admission.admitted, atIdx)
		return ok({ids: admission.admitted.map(item => item.id), skippedAlreadyQueued: admission.skippedAlreadyQueued})
	}

	probeFailed(itemId: string, error: LocalizedError): Result<void> {
		return this.apply(itemId, {kind: 'probe-failed', error})
	}

	needsChoice(itemId: string, choice: QueueChoice, title: string): Result<void> {
		return this.apply(itemId, {kind: 'needs-choice', choice, title})
	}

	reprobe(itemId: string): Result<void> {
		return this.apply(itemId, {kind: 'probe-restarted'})
	}

	start(itemId: string): Result<void> {
		const item = this.find(itemId)
		if (item?.status === QUEUE_STATUS.pausedHeld || item?.status === QUEUE_STATUS.pausedActive) this.requeue(item)
		this.pump()
		return ok(undefined)
	}

	pause(itemId: string): Result<void> {
		const item = this.find(itemId)
		if (!item) return ok(undefined)
		if (item.status === QUEUE_STATUS.running) this.stopRun(item.id, 'pause')
		else if (item.status === QUEUE_STATUS.pending) this.set(transition(item, {kind: 'paused-held'}))
		return ok(undefined)
	}

	resume(itemId: string): Result<void> {
		return this.start(itemId)
	}

	cancel(itemId: string | null): Result<void> {
		const targets = itemId === null ? [...this.items] : [this.find(itemId)].filter((item): item is QueueItem => item !== undefined)
		for (const item of targets) this.cancelItem(item)
		if (itemId === null && this.schedulerPaused) this.setSchedulerPaused(false)
		return ok(undefined)
	}

	retry(itemId: string): Result<void> {
		const item = this.find(itemId)
		if (!item || resolvedJob(item) === null) return ok(undefined)
		if (item.status === QUEUE_STATUS.error || item.status === QUEUE_STATUS.cancelled || item.status === QUEUE_STATUS.done) {
			this.set(transition(item, {kind: 'retry-reset'}))
			this.pump()
		}
		return ok(undefined)
	}

	remove(itemId: string): Result<void> {
		const item = this.find(itemId)
		if (!item) return ok(undefined)
		if (this.active.has(itemId)) this.stopRun(itemId, 'cancel')
		else void this.discardJobDir(itemId)
		this.removeItem(itemId)
		return ok(undefined)
	}

	clearCompleted(): Result<void> {
		for (const item of this.items.filter(entry => entry.status === QUEUE_STATUS.done)) this.removeItem(item.id)
		return ok(undefined)
	}

	setLane(itemId: string, lane: QueueLane): Result<void> {
		const item = this.find(itemId)
		if (item) this.set({...item, lane})
		this.pump()
		return ok(undefined)
	}

	applySelectionAction(action: QueueSelectionAction, itemIds: string[]): Result<QueueSelectionCommandResult> {
		const appliedIds: string[] = []
		const skipped: QueueActionSkippedItem[] = []
		for (const itemId of itemIds) {
			const item = this.find(itemId)
			if (!item) {
				skipped.push({itemId, reason: 'not-found'})
				continue
			}
			if (!canApplyQueueActionToItem(action, item)) {
				skipped.push({itemId, status: item.status, reason: 'invalid-status'})
				continue
			}
			if (action === 'pause') this.pause(itemId)
			else if (action === 'resume') this.resume(itemId)
			else if (action === 'cancel') this.cancel(itemId)
			else if (action === 'retry') this.retry(itemId)
			else if (action === 'remove') this.remove(itemId)
			else this.setLane(itemId, 'priority')
			appliedIds.push(itemId)
		}
		return ok({action, appliedIds, skipped})
	}

	// Android files always land in the one public download folder, so a target
	// change only relabels the rows that have not finished yet.
	changeOutputTarget(itemIds: string[], outputDir: string): Result<QueueOutputTargetChangeResult> {
		const items: QueueOutputTargetChangeItemResult[] = []
		const skipped: QueueActionSkippedItem[] = []
		for (const itemId of itemIds) {
			const item = this.find(itemId)
			if (!item) skipped.push({itemId, reason: 'not-found'})
			else if (!canApplyQueueActionToItem('change-output-target', item)) skipped.push({itemId, status: item.status, reason: 'invalid-status'})
			else {
				this.set({...item, outputDir})
				items.push({itemId, moved: [], missing: []})
			}
		}
		return ok({outputDir, items, skipped})
	}

	pauseAll(): Result<void> {
		this.setSchedulerPaused(true)
		for (const item of this.items.filter(entry => entry.status === QUEUE_STATUS.running)) this.stopRun(item.id, 'pause')
		return ok(undefined)
	}

	resumeAll(): Result<void> {
		this.setSchedulerPaused(false)
		for (const item of this.items.filter(entry => entry.status === QUEUE_STATUS.pausedActive || entry.status === QUEUE_STATUS.pausedHeld)) this.requeue(item)
		this.pump()
		return ok(undefined)
	}

	private find(itemId: string): QueueItem | undefined {
		return this.items.find(item => item.id === itemId)
	}

	private persist(): void {
		this.deps.persistence.save(this.snapshot())
	}

	private set(next: QueueItem): void {
		const index = this.items.findIndex(item => item.id === next.id)
		if (index < 0) return
		this.items[index] = next
		this.persist()
		this.deps.listeners.updated(next)
	}

	private insert(items: QueueItem[], atIdx: number): void {
		this.items.splice(atIdx, 0, ...items)
		this.persist()
		this.deps.listeners.added(items, atIdx)
		this.pump()
	}

	private removeItem(itemId: string): void {
		const index = this.items.findIndex(item => item.id === itemId)
		if (index < 0) return
		this.items.splice(index, 1)
		this.persist()
		this.deps.listeners.removed(itemId)
	}

	private apply(itemId: string, evt: QueueEvent): Result<void> {
		const item = this.find(itemId)
		if (!item) return stale(`${evt.kind} targets a missing item`)
		const reason = illegalTransition(item, evt)
		if (reason) return stale(reason)
		this.set(transition(item, evt))
		return ok(undefined)
	}

	private requeue(item: QueueItem): void {
		this.set({...item, status: QUEUE_STATUS.pending, progressDetail: null})
	}

	private setSchedulerPaused(paused: boolean): void {
		if (this.schedulerPaused === paused) return
		this.schedulerPaused = paused
		this.persist()
		this.deps.listeners.scheduler(paused)
	}

	private cancelItem(item: QueueItem): void {
		if (isPlaceholder(item)) {
			this.removeItem(item.id)
			return
		}
		if (this.active.has(item.id)) {
			this.stopRun(item.id, 'cancel')
			return
		}
		if (illegalTransition(item, {kind: 'cancelled'}) !== null || item.status === QUEUE_STATUS.done || item.status === QUEUE_STATUS.cancelled) return
		this.set({...transition(item, {kind: 'cancelled'}), progressDetail: null, finishedAt: this.deps.now()})
		void this.discardJobDir(item.id)
	}

	private stopRun(itemId: string, reason: StopReason): void {
		const run = this.active.get(itemId)
		if (!run) return
		run.stop = reason
		void this.deps.native.cancelRun(run.runId)
	}

	private async discardJobDir(itemId: string): Promise<void> {
		await this.deps.native.removeDir(await this.jobDir(itemId))
	}

	private async jobDir(itemId: string): Promise<string> {
		return `${await this.deps.workDir()}/jobs/${itemId}`
	}

	private concurrency(): number {
		return Math.min(MAX_CONCURRENT_DOWNLOADS, Math.max(1, this.deps.common().concurrentDownloads ?? NORMAL_LANE_CAP))
	}

	private pump(): void {
		if (this.schedulerPaused) return
		while (this.active.size < this.concurrency()) {
			const pending = this.items.filter(item => item.status === QUEUE_STATUS.pending && !this.active.has(item.id))
			const next = pending.find(item => item.lane === 'priority') ?? pending[0]
			if (!next) return
			void this.run(next)
		}
	}

	private async run(item: QueueItem): Promise<void> {
		const job = resolvedJob(item)
		if (!job) return
		const runId = this.deps.newId()
		const run: ActiveRun = {runId, stop: null}
		this.active.set(item.id, run)
		this.set(transition(item, {kind: 'started', lastJobId: runId}))
		try {
			const outcome = await runQueueJob({
				native: this.deps.native,
				runId,
				url: item.url,
				job,
				jobDir: await this.jobDir(item.id),
				common: this.deps.common(),
				now: this.deps.now,
				onProgress: progress => {
					const current = this.find(item.id)
					if (current?.status !== QUEUE_STATUS.running) return
					this.set({...transition(current, {kind: 'progress', percent: progress.percent ?? current.progressPercent, detail: progress.detail}), lastStatus: {key: progress.statusKey}})
				}
			})
			const current = this.find(item.id)
			if (!current) return
			if (outcome.kind === 'stopped' || run.stop !== null) {
				if (run.stop === 'pause') this.set(transition(current, {kind: 'paused-active', tempDir: await this.jobDir(item.id)}))
				else {
					this.set({...transition(current, {kind: 'cancelled'}), progressDetail: null, finishedAt: this.deps.now(), lastStatus: {key: STATUS_KEY.cancelled}})
					await this.discardJobDir(item.id)
				}
			} else if (outcome.kind === 'failed') {
				this.set(transition(current, {kind: 'failed', error: outcome.error, lastStatusKey: STATUS_KEY.ytdlpExitCode}))
			} else {
				this.set({...transition(current, {kind: 'completed', finishedAt: this.deps.now(), lastStatusKey: outcome.subtitlesFailed ? STATUS_KEY.subtitlesFailed : STATUS_KEY.complete}), progressDetail: null, artifacts: outcome.artifacts})
			}
		} catch (error) {
			const current = this.find(item.id)
			if (current) this.set(transition(current, {kind: 'failed', error: {kind: 'unknown', raw: error instanceof Error ? error.message : String(error)}, lastStatusKey: STATUS_KEY.ytdlpProcessError}))
		} finally {
			this.active.delete(item.id)
			this.pump()
		}
	}
}
