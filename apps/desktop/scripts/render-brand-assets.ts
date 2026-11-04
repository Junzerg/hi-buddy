/** Regenerate desktop, installer, and browser artwork from the HiBuddy artwork masters. */
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
const root = /<svg[^>]*viewBox="([^"]+)"[^>]*>/u.exec(mark)
if (root === null) throw new Error('brand artwork: mark.svg requires a viewBox')
const [x, y, width, height] = root[1]!.split(' ').map(Number)
if (x === undefined || y === undefined || width === undefined || height === undefined) {
  throw new Error('brand artwork: mark.svg requires four viewBox coordinates')
}
const paths = mark.slice(mark.indexOf('>') + 1, mark.lastIndexOf('</svg>'))
const brandPath = /<path[^>]* d="([^"]+)"/u.exec(mark)?.[1]
const gradient = /<linearGradient[^>]* x1="([^"]+)"[^>]* x2="([^"]+)"/u.exec(mark)
const colors = [...mark.matchAll(/stop-color="([^"]+)"/gu)].map(match => match[1]!)
if (brandPath === undefined || gradient === null || colors.length !== 2) throw new Error('brand artwork: expected the H path and two-color gradient')
const svg = (body: string, w: number, h: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">\n${body}\n</svg>\n`
const markAt = (left: number, top: number, size: number): string =>
  `<g transform="translate(${left} ${top}) scale(${size / width}) translate(${-x} ${-y})">${paths}</g>`
const icon = svg(`<g id="tray-glyph">${markAt(72, (1024 - 880 * height / width) / 2, 880)}</g>`, 1024, 1024)
for (const suffix of ['', '-windows', '-macos']) {
  await writeFile(new URL(`resources/icon${suffix}.svg`, desktopRoot), icon)
  await sharp(Buffer.from(icon)).png().toFile(fileURLToPath(new URL(`resources/icon${suffix}.png`, desktopRoot)))
}
await writeFile(TRAY_ICON_PATHS.output, packIco(await renderTrayIconEntries(Buffer.from(icon))))
for (const dark of [false, true]) {
  const banner = new URL(`renderer/assets/welcome-banner${dark ? '-dark' : ''}.png`, desktopRoot)
  for (const scale of [1, 2]) {
    const file = `brand${dark ? '-dark' : ''}${scale === 2 ? '-2x' : ''}.png`
    await sharp(fileURLToPath(banner)).resize(600 * scale, 196 * scale, {
      fit: 'contain', background: dark ? '#0e1b2c' : '#ffffff',
    }).png().toFile(fileURLToPath(new URL(`installer/assets/${file}`, desktopRoot)))
  }
}
await sharp(Buffer.from(svg('<rect width="164" height="314" fill="#F3F5F8"/>' + markAt(22, 115, 120), 164, 314)))
  .png().toFile(fileURLToPath(new URL('installer/assets/uninstaller-sidebar.png', desktopRoot)))
const welcome = svg(markAt(4, (64 - 56 * height / width) / 2, 56), 64, 64)
await writeFile(new URL('renderer/assets/welcome-brand.svg', desktopRoot), welcome)
await writeFile(new URL('../../../packages/client/ui-primitives/src/brand-artwork.ts', import.meta.url),
  '/** Vector artwork generated from ui-brand-official/artwork/mark.svg. */\n'
  + `export const BRAND_VIEWBOX = { x: ${x}, y: ${y}, width: ${width}, height: ${height} } as const\n`
  + `export const BRAND_PATH = ${JSON.stringify(brandPath)}\n`
  + `export const BRAND_GRADIENT = ${JSON.stringify({ start: Number(gradient[1]), end: Number(gradient[2]), colors })} as const\n`)

for (const file of ['favicon.svg', 'favicon-dark.svg']) await writeFile(join(iconOutputDirectory, file), icon)
execFileSync(process.execPath, ['--import', 'tsx/esm', fileURLToPath(new URL('../../web/scripts/render-app-icons.ts', import.meta.url))], { stdio: 'inherit' })
console.info('brand artwork: regenerated desktop, installer, sidebar, welcome, favicon, and install icons')
