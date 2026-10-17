// Small text helpers for the Android screens. Pure.

export function formatDuration(seconds: number | undefined): string | null {
	if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null
	const total = Math.round(seconds)
	const h = Math.floor(total / 3600)
	const m = Math.floor((total % 3600) / 60)
	const s = total % 60
	const pad = (n: number): string => String(n).padStart(2, '0')
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export interface ProgressFacts {
	size: string | null
	speed: string | null
	eta: string | null
}

// yt-dlp's progress text ("42.0% of ~10.00MiB at 1.20MiB/s ETA 00:06") as the
// three facts a phone row has room for.
export function progressFacts(detail: string | null): ProgressFacts {
	if (!detail) return {size: null, speed: null, eta: null}
	const size = /of\s+~?\s*([\d.]+\s*[KMGT]?i?B)/i.exec(detail)?.[1] ?? null
	const speed = /at\s+([\d.]+\s*[KMGT]?i?B\/s)/i.exec(detail)?.[1] ?? null
	const eta = /ETA\s+([\d:]+)/i.exec(detail)?.[1] ?? null
	return {size: size?.replace(/\s+/g, '') ?? null, speed: speed?.replace(/\s+/g, '') ?? null, eta}
}

export function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return url
	}
}
