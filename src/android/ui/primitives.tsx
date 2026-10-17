// The handful of building blocks the Android screens share. They encode this
// shell's own look (ember, warm surfaces, Material-like shapes) and nothing
// from the desktop kit.

import type {ButtonHTMLAttributes, ReactNode} from 'react'
import {cx} from './cx.js'

type ButtonTone = 'filled' | 'tonal' | 'text'

const BUTTON_TONES: Record<ButtonTone, string> = {filled: 'bg-ember text-on-ember shadow-lift active:bg-ember-strong', tonal: 'bg-ember-soft text-on-ember-soft active:brightness-95', text: 'text-ember active:bg-ember-soft'}

export function Button({tone = 'filled', className, children, ...rest}: ButtonHTMLAttributes<HTMLButtonElement> & {tone?: ButtonTone}): ReactNode {
	return (
		<button type="button" {...rest} className={cx('inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-medium transition-[background-color,transform] active:scale-[0.98] disabled:opacity-40', BUTTON_TONES[tone], className)}>
			{children}
		</button>
	)
}

export function IconButton({label, className, children, ...rest}: ButtonHTMLAttributes<HTMLButtonElement> & {label: string}): ReactNode {
	return (
		<button type="button" aria-label={label} title={label} {...rest} className={cx('inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors active:bg-surface-2', className)}>
			{children}
		</button>
	)
}

export function Card({className, children}: {className?: string; children: ReactNode}): ReactNode {
	return <section className={cx('rounded-card bg-surface shadow-lift', className)}>{children}</section>
}

export function ProgressBar({percent, indeterminate = false, tone = 'ember'}: {percent: number; indeterminate?: boolean; tone?: 'ember' | 'moss' | 'muted'}): ReactNode {
	const fill = tone === 'moss' ? 'bg-moss' : tone === 'muted' ? 'bg-muted' : 'bg-ember'
	return (
		<div className="relative h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : Math.round(percent)}>
			{indeterminate ? <div className={cx('absolute inset-y-0 w-2/5 rounded-full animate-indeterminate', fill)} /> : <div className={cx('h-full rounded-full transition-[width] duration-300', fill)} style={{width: `${Math.min(100, Math.max(0, percent))}%`}} />}
		</div>
	)
}

export function Segmented<T extends string>({value, options, onChange, label}: {value: T; options: readonly {value: T; label: string}[]; onChange: (value: T) => void; label: string}): ReactNode {
	return (
		<div role="radiogroup" aria-label={label} className="flex rounded-full bg-surface-2 p-1">
			{options.map(option => (
				<button key={option.value} type="button" role="radio" aria-checked={option.value === value} onClick={() => onChange(option.value)} className={cx('min-h-10 flex-1 rounded-full px-3 text-sm font-medium transition-colors', option.value === value ? 'bg-surface text-ink shadow-lift' : 'text-muted')}>
					{option.label}
				</button>
			))}
		</div>
	)
}

export function ScreenHeader({title, subtitle, trailing}: {title: string; subtitle?: string; trailing?: ReactNode}): ReactNode {
	return (
		<header className="flex items-end justify-between gap-3 px-5 pb-4 pt-6">
			<div className="min-w-0">
				<h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
				{subtitle ? <p className="mt-1 text-[15px] text-muted">{subtitle}</p> : null}
			</div>
			{trailing}
		</header>
	)
}
