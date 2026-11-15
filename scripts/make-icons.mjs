// Generates every PNG icon from the master public/icon.svg (PLAN §21.2).
// Run with: npm run icons   (outputs are committed as static files)
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url))
const master = await readFile(pub('icon.svg'), 'utf8')

// Full-bleed variant: square plate, artwork scaled into the central safe zone so
// Android's circle/squircle mask and iOS's own rounding never cut the bat or ball.
const fullBleed = master
  .replace('rx="113"', 'rx="0"')
  .replace('<g id="art">', '<g id="art" transform="translate(256 256) scale(0.8) translate(-256 -256)">')

const png = (svg, size) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png()

await png(master, 192).toFile(pub('icon-192.png'))
await png(master, 512).toFile(pub('icon-512.png'))
await png(master, 32).toFile(pub('favicon-32.png'))
await png(fullBleed, 512).toFile(pub('icon-maskable-512.png'))
await png(fullBleed, 180).flatten({ background: '#9B1C1F' }).toFile(pub('apple-touch-icon.png'))

// Monochrome notification badge: white ball with a seam cut out, on transparent.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">
  <mask id="m"><rect width="72" height="72" fill="#fff"/>
    <path d="M24 14 Q42 36 27 59" fill="none" stroke="#000" stroke-width="5" stroke-linecap="round"/></mask>
  <circle cx="36" cy="36" r="27" fill="#fff" mask="url(#m)"/>
</svg>`
await png(badge, 72).toFile(pub('badge-72.png'))

console.log('icons written to public/')
