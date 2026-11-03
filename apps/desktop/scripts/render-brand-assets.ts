/** Regenerate desktop, installer, and browser artwork from the HiBuddy vector masters. */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
import { packIco, renderTrayIconEntries, TRAY_ICON_PATHS } from './render-tray-icon.ts'
import { join } from 'node:path'

const artworkRoot = new URL('../../../packages/client/ui-brand-official/artwork/', import.meta.url)
const desktopRoot = new URL('../', import.meta.url)
const iconOutputDirectory = fileURLToPath(new URL('../../web/public/', import.meta.url))
const mark = await readFile(new URL('mark.svg', artworkRoot), 'utf8')
const name = await readFile(new URL('name.svg', artworkRoot), 'utf8')
const root = /<svg[^>]*viewBox="([^"]+)"[^>]*>/u.exec(mark)
if (root === null) throw new Error('brand artwork: mark.svg requires a viewBox')
const [x, y, width, height] = root[1]!.split(' ').map(Number)
if (x === undefined || y === undefined || width === undefined || height === undefined) {
  throw new Error('brand artwork: mark.svg requires four viewBox coordinates')
}
const petals = [...mark.matchAll(/<path fill="([^"]+)" d="([^"]+)"\s*\/>/gu)]
  .map(match => ({ fill: match[1]!, d: match[2]! }))
if (petals.length !== 6) throw new Error('brand artwork: mark.svg requires six colored petals')
const paths = petals.map(petal => `<path fill="${petal.fill}" d="${petal.d}"/>`).join('\n')
const nameBody = name.slice(name.indexOf('>') + 1, name.lastIndexOf('</svg>'))
const svg = (body: string, w: number, h: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">\n${body}\n</svg>\n`
const markAt = (left: number, top: number, size: number): string =>
  `<g transform="translate(${left} ${top}) scale(${size / width}) translate(${-x} ${-y})">${paths}</g>`
const nameAt = (left: number, top: number, size: number, ink: string, inverse: string): string =>
  `<g transform="translate(${left} ${top}) scale(${size / 136})">${nameBody
    .replaceAll('currentColor', ink).replaceAll('var(--dsw-alias-label-primary-inverted)', inverse)}</g>`
const icon = svg(`<g id="tray-glyph">${markAt(72, (1024 - 880 * height / width) / 2, 880)}</g>`, 1024, 1024)
for (const suffix of ['', '-windows', '-macos']) {
  await writeFile(new URL(`resources/icon${suffix}.svg`, desktopRoot), icon)
  await sharp(Buffer.from(icon)).png().toFile(fileURLToPath(new URL(`resources/icon${suffix}.png`, desktopRoot)))
}
await writeFile(TRAY_ICON_PATHS.output, packIco(await renderTrayIconEntries(Buffer.from(icon))))
for (const dark of [false, true]) {
  const lockup = svg(markAt(240, 12, 120) + nameAt(195, 140, 210, dark ? '#F9FAFB' : '#0F1115', dark ? '#353638' : '#FFFFFF'), 600, 196)
  for (const scale of [1, 2]) {
    const file = `brand${dark ? '-dark' : ''}${scale === 2 ? '-2x' : ''}.png`
    await sharp(Buffer.from(lockup), { density: 72 * scale }).png()
      .toFile(fileURLToPath(new URL(`installer/assets/${file}`, desktopRoot)))
  }
}
await sharp(Buffer.from(svg('<rect width="164" height="314" fill="#F3F5F8"/>' + markAt(22, 115, 120), 164, 314)))
  .png().toFile(fileURLToPath(new URL('installer/assets/uninstaller-sidebar.png', desktopRoot)))
const welcome = svg('<style>:root{--brand-ink:#0F1115;--brand-inverse:#FFFFFF}@media(prefers-color-scheme:dark){:root{--brand-ink:#F9FAFB;--brand-inverse:#353638}}</style>'
  + markAt(148, 8, 34) + nameAt(196, 8, 136, 'var(--brand-ink)', 'var(--brand-inverse)'), 472, 40)
await writeFile(new URL('renderer/assets/welcome-brand.svg', desktopRoot), welcome)
await writeFile(new URL('../../../packages/client/ui-primitives/src/brand-artwork.ts', import.meta.url),
  '/** Vector geometry generated from ui-brand-official/artwork/mark.svg by apps/desktop/scripts/render-brand-assets.ts. */\n'
  + `\n/** Native coordinates of the six-petal mark. */\nexport const FLOWER_VIEWBOX = { x: ${x}, y: ${y}, width: ${width}, height: ${height} } as const\n`
  + '\n/** Solid fills and smooth contours of the six connected petals. */\nexport const FLOWER_PETALS = [\n'
  + petals.map(petal => `  { fill: '${petal.fill}', d: '${petal.d}' },`).join('\n') + '\n] as const\n')
for (const file of ['favicon.svg', 'favicon-dark.svg']) await writeFile(join(iconOutputDirectory, file), icon)
execFileSync(process.execPath, ['--import', 'tsx/esm', fileURLToPath(new URL('../../web/scripts/render-app-icons.ts', import.meta.url))], { stdio: 'inherit' })
console.info('brand artwork: regenerated desktop, installer, sidebar, welcome, favicon, and install icons')
