// Builds the Android app's web half: src/android/index.html, booted through
// src/android/main.ts with the Android interface in src/android/ui. Output goes
// to out/android-web, which capacitor.config.json copies into the Android
// project (`bun run android:sync`).

import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite-plus'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const require = createRequire(import.meta.url)
const {version} = require('../../package.json') as {version: string}

export default defineConfig({
	root: here,
	base: './',
	mode: 'android',
	publicDir: false,
	define: {__APP_VERSION__: JSON.stringify(version), 'process.env': '{}'},
	resolve: {
		alias: {
			'@shared': path.join(repoRoot, 'src/shared'),
			'yt-dlp-bridge/parsers': path.join(repoRoot, 'packages/yt-dlp-bridge/src/parsers.ts'),
			'yt-dlp-bridge': path.join(repoRoot, 'packages/yt-dlp-bridge/src/index.ts'),
			'ytdlp-errors': path.join(repoRoot, 'packages/ytdlp-errors/src/index.ts'),
			// yt-dlp-bridge's planner reads these once at import time; see shims/.
			'node:path': path.join(here, 'shims/path.ts'),
			'node:os': path.join(here, 'shims/os.ts'),
			'node:fs': path.join(here, 'shims/fs.ts')
		}
	},
	plugins: [react(), tailwindcss()],
	build: {outDir: path.join(repoRoot, 'out/android-web'), emptyOutDir: true, target: 'es2022'}
})
