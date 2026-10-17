// Builds the renderer for the Android shell: the same index.html and React app,
// booted through src/android/main.ts, which installs the native-backed AppApi.
// Output goes to out/android-web, which capacitor.config.json copies into the
// Android project (`bun run android:sync`).

import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import Icons from 'unplugin-icons/vite'
import {defineConfig, type Plugin, type PluginOption} from 'vite-plus'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const require = createRequire(import.meta.url)
const {version} = require('../../package.json') as {version: string}

const ANDROID_ENTRY = '/@arroxy-android-entry'

// Swap the renderer's own entry for the Android composition root, so the
// renderer source and its index.html stay identical across shells.
function androidEntryPlugin(): Plugin {
	return {name: 'arroxy-android-entry', enforce: 'pre', transformIndexHtml: {order: 'pre', handler: html => html.replace('src="/src/main.tsx"', `src="${ANDROID_ENTRY}"`)}, resolveId: source => (source === ANDROID_ENTRY ? path.join(here, 'main.ts') : null)}
}

export default defineConfig({
	root: path.join(repoRoot, 'src/renderer'),
	base: './',
	mode: 'android',
	define: {__APP_VERSION__: JSON.stringify(version), 'process.env': '{}'},
	resolve: {
		alias: {
			'@renderer': path.join(repoRoot, 'src/renderer/src'),
			'@shared': path.join(repoRoot, 'src/shared'),
			'yt-dlp-bridge/parsers': path.join(repoRoot, 'packages/yt-dlp-bridge/src/parsers.ts'),
			'yt-dlp-bridge': path.join(repoRoot, 'packages/yt-dlp-bridge/src/index.ts'),
			'ytdlp-errors': path.join(repoRoot, 'packages/ytdlp-errors/src/index.ts'),
			'node:path': path.join(here, 'shims/path.ts'),
			'node:os': path.join(here, 'shims/os.ts'),
			'node:fs': path.join(here, 'shims/fs.ts')
		}
	},
	plugins: [androidEntryPlugin(), react(), tailwindcss(), Icons({compiler: 'jsx', jsx: 'react'}) as PluginOption],
	build: {outDir: path.join(repoRoot, 'out/android-web'), emptyOutDir: true, target: 'es2022'}
})
