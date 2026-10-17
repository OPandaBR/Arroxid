// `node:fs` for the Android WebView bundle. Only the bridge's managed-archive
// helpers touch it, and the Android shell never plans those workflows.
function unavailable(): never {
	throw new Error('node:fs is not available in the Android WebView')
}

const fs = {existsSync: (): boolean => false, readFileSync: unavailable, promises: {mkdir: unavailable}}

export default fs
