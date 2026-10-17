import {readFileSync, readdirSync} from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vite-plus/test'

// The Android app is Pingo. "Arroxy" may appear in what a user sees only where
// Pingo credits the project it is built on.
const ATTRIBUTION = /'settings\.basedOn'|name="(package_name|custom_url_scheme)"/

function linesNaming(file: string, word: RegExp): string[] {
	return readFileSync(file, 'utf8')
		.split('\n')
		.filter(line => word.test(line) && !ATTRIBUTION.test(line))
}

describe('Pingo brand on Android', () => {
	it('names Pingo, not Arroxy, in every interface string', () => {
		expect(linesNaming('src/android/ui/i18n.ts', /Arroxy/)).toEqual([])
	})

	it('names Pingo in the system labels (launcher, share sheet, shortcuts, notifications)', () => {
		const res = 'android/app/src/main/res'
		const stringFiles = readdirSync(res)
			.filter(dir => dir.startsWith('values'))
			.map(dir => path.join(res, dir, 'strings.xml'))
			.filter(file => {
				try {
					return readFileSync(file, 'utf8').length > 0
				} catch {
					return false
				}
			})
		expect(stringFiles.flatMap(file => linesNaming(file, /arroxy/i))).toEqual([])
		expect(readFileSync(path.join(res, 'values/strings.xml'), 'utf8')).toContain('<string name="app_name">Pingo</string>')
	})

	it('saves into Download/Pingo', () => {
		expect(readFileSync('android/app/src/main/java/com/arroxy/pingo/SharedStorage.java', 'utf8')).toContain('PUBLIC_SUBDIR = "Pingo"')
	})
})
