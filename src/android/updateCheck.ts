// The Android take on the desktop update banner: look at the latest GitHub
// release and offer it only when it is newer and actually ships an APK
// (releases are cut for desktop first). The reply crosses a trust boundary.

import {z} from 'zod'

const LATEST_RELEASE_URL = 'https://api.github.com/repos/antonio-orionus/Arroxy/releases/latest'

const releaseSchema = z.object({tag_name: z.string(), html_url: z.url(), assets: z.array(z.object({name: z.string()}))})

export interface AndroidUpdate {
	version: string
	url: string
}

function versionParts(version: string): number[] {
	return version
		.replace(/^v/, '')
		.split('-')[0]
		.split('.')
		.map(part => Number.parseInt(part, 10) || 0)
}

function isNewer(candidate: string, current: string): boolean {
	const a = versionParts(candidate)
	const b = versionParts(current)
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0)
		if (diff !== 0) return diff > 0
	}
	return false
}

export function pickAndroidUpdate(raw: unknown, currentVersion: string): AndroidUpdate | null {
	const parsed = releaseSchema.safeParse(raw)
	if (!parsed.success) return null
	const release = parsed.data
	if (!release.assets.some(asset => asset.name.toLowerCase().endsWith('.apk'))) return null
	const version = release.tag_name.replace(/^v/, '')
	return isNewer(version, currentVersion) ? {version, url: release.html_url} : null
}

export async function checkForAndroidUpdate(currentVersion: string, fetchJson: (url: string) => Promise<unknown>): Promise<AndroidUpdate | null> {
	try {
		return pickAndroidUpdate(await fetchJson(LATEST_RELEASE_URL), currentVersion)
	} catch {
		return null
	}
}
