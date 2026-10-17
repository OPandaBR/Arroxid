import {RotateCw} from 'lucide-react'
import type {ReactNode} from 'react'
import {t} from '../i18n.js'
import {LogoMark, Wordmark} from '../Logo.js'
import {Button, ProgressBar} from '../primitives.js'
import {useShell} from '../shellContext.js'

export function BootScreen(): ReactNode {
	const boot = useShell(state => state.boot)
	const start = useShell(state => state.start)
	return (
		<main className="pt-safe pb-safe flex h-full flex-col items-center justify-center gap-6 px-10 text-center">
			<LogoMark size={88} className={boot.kind === 'starting' ? 'animate-pulse-soft' : undefined} />
			<Wordmark className="text-[26px] font-semibold tracking-tight text-ink" />
			{boot.kind === 'failed' ? (
				<div className="flex flex-col items-center gap-4">
					<p className="text-[15px] text-ink">{t('boot.failed')}</p>
					<details className="w-full text-sm text-muted">
						<summary className="py-1">{t('error.details')}</summary>
						<p className="mt-2 max-h-40 overflow-auto rounded-xl bg-surface-2 p-3 text-left font-mono text-[12px] wrap-anywhere">{boot.message}</p>
					</details>
					<Button onClick={() => void start()}>
						<RotateCw size={18} />
						{t('boot.retry')}
					</Button>
				</div>
			) : (
				<div className="flex w-48 flex-col gap-3">
					<ProgressBar percent={0} indeterminate />
					<p className="text-sm text-muted">{t('boot.preparing')}</p>
				</div>
			)}
		</main>
	)
}
