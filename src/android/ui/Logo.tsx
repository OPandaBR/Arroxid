import {useId, type ReactNode} from 'react'

// Pingo's mark: a drop (a file falling into the phone) on an ember tile,
// with the arrow cut out of it and the ground it lands on.
export function LogoMark({size = 48, className}: {size?: number; className?: string}): ReactNode {
	const id = useId()
	return (
		<svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true">
			<defs>
				<linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="#ff8a5b" />
					<stop offset="1" stopColor="#d9431c" />
				</linearGradient>
				<mask id={`${id}-cut`}>
					<rect width="48" height="48" fill="#fff" />
					<path d="M24 18.5v13M18.8 26.6 24 31.8l5.2-5.2" stroke="#000" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
				</mask>
			</defs>
			<rect width="48" height="48" rx="14" fill={`url(#${id}-tile)`} />
			<g transform="translate(4.8 4.4) scale(0.8)">
				<path d="M24 8s-10.5 12.5-10.5 19.5a10.5 10.5 0 0 0 21 0C34.5 20.5 24 8 24 8Z" fill="#fff5ec" mask={`url(#${id}-cut)`} />
				<path d="M16.5 43h15" stroke="#fff5ec" strokeOpacity="0.7" strokeWidth="3.2" strokeLinecap="round" />
			</g>
		</svg>
	)
}

export function Wordmark({className}: {className?: string}): ReactNode {
	return (
		<span className={className}>
			pingo<span className="text-ember">.</span>
		</span>
	)
}
