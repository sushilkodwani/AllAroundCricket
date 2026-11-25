// Season card: one player's season (or all their matches) on one picture, drawn on a canvas so it
// can be shared to WhatsApp like any photo (see resultCard.ts). Same look as the highlight card.
import type { Wrapped } from './playerSeason'

const W = 1080
const H = 1350
const INK = '#111111'
const MUTED = '#6B6B6B'
const LINE = '#E5E5E5'
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

export interface SeasonMeta {
  name: string
  team: string
  color?: string
  jersey?: number
}

const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`

export function drawSeasonCard(w: Wrapped, meta: SeasonMeta): HTMLCanvasElement {
  const colour = meta.color ?? '#9B1C1F'
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const text = (str: string, x: number, y: number, font: string, color = INK, align: CanvasTextAlign = 'left', max = W - 160) => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(fit(ctx, str, max), x, y)
  }

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, W, 360)
  ctx.fillStyle = 'rgba(255,255,255,0.2)'
  ctx.beginPath()
  ctx.roundRect(80, 80, 200, 200, 40)
  ctx.fill()
  const badge = meta.jersey !== undefined ? String(meta.jersey) : meta.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
  text(badge, 180, 212, `700 88px ${FONT}`, '#FFFFFF', 'center', 180)
  text(meta.name, 320, 160, `700 64px ${FONT}`, '#FFFFFF', 'left', W - 400)
  text(meta.team, 320, 220, `400 36px ${FONT}`, '#FFFFFF', 'left', W - 400)
  // The kind of player, as a pill in the header's bottom right.
  let labelMax = W - 400
  if (w.archetype) {
    ctx.font = `700 34px ${FONT}`
    const pw = Math.min(420, ctx.measureText(w.archetype).width + 64)
    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.roundRect(W - 80 - pw, 236, pw, 64, 32)
    ctx.fill()
    text(w.archetype, W - 80 - pw / 2, 280, `700 34px ${FONT}`, colour, 'center', pw - 32)
    labelMax = W - 80 - pw - 340
  }
  text(w.label, 320, 272, `600 36px ${FONT}`, '#FFFFFF', 'left', labelMax)
  text(`${w.matches} ${w.matches === 1 ? 'match' : 'matches'}`, 80, 330, `400 28px ${FONT}`, 'rgba(255,255,255,0.85)')

  // The two headline numbers: runs and wickets (whichever they have).
  const heads: { value: string; label: string; sub: string }[] = []
  if (w.bat) heads.push({ value: String(w.bat.runs), label: 'runs', sub: `${w.bat.balls} balls · strike rate ${w.bat.balls ? ((w.bat.runs * 100) / w.bat.balls).toFixed(0) : '–'}` })
  if (w.bowl) heads.push({ value: String(w.bowl.wickets), label: w.bowl.wickets === 1 ? 'wicket' : 'wickets', sub: `${overs(w.bowl.balls)} overs · economy ${w.bowl.balls ? ((w.bowl.runs * 6) / w.bowl.balls).toFixed(1) : '–'}` })
  const colW = (W - 160) / Math.max(1, heads.length)
  heads.forEach((h, i) => {
    const cx = 80 + colW * i + colW / 2
    text(h.value, cx, 560, `800 190px ${FONT}`, INK, 'center', colW - 20)
    text(h.label, cx, 620, `600 40px ${FONT}`, colour, 'center', colW - 20)
    text(h.sub, cx, 672, `400 28px ${FONT}`, MUTED, 'center', colW - 20)
  })

  const tiles: [string, string][] = [['Matches', String(w.matches)], ['Won', String(w.wins)], ['Catches', String(w.catches)], ['Badges', String(w.badges)]]
  if (w.potm > 0) tiles[3] = ['POTM awards', String(w.potm)]
  const gap = 24
  const tw = (W - 160 - gap * (tiles.length - 1)) / tiles.length
  tiles.forEach(([label, value], i) => {
    const x = 80 + i * (tw + gap)
    ctx.fillStyle = '#F4F4F4'
    ctx.beginPath()
    ctx.roundRect(x, 740, tw, 150, 24)
    ctx.fill()
    text(value, x + tw / 2, 818, `700 52px ${FONT}`, INK, 'center', tw - 20)
    text(label, x + tw / 2, 862, `400 24px ${FONT}`, MUTED, 'center', tw - 16)
  })

  let y = 980
  if (w.bat) {
    text('Best innings', 80, y, `400 30px ${FONT}`, MUTED)
    text(`${w.bat.best.runs}${w.bat.best.notOut ? '*' : ''} vs ${w.bat.best.opponent}`, 80, y + 50, `700 44px ${FONT}`, INK)
    y += 110
  }
  if (w.bowl && w.bowl.best.wickets > 0) {
    text('Best spell', 80, y, `400 30px ${FONT}`, MUTED)
    text(`${w.bowl.best.wickets}/${w.bowl.best.runs} vs ${w.bowl.best.opponent}`, 80, y + 50, `700 44px ${FONT}`, INK)
    y += 110
  }
  ctx.fillStyle = LINE
  ctx.fillRect(80, H - 170, W - 160, 2)
  text(`${meta.name}’s ${w.label.toLowerCase()}`, 80, H - 110, `600 32px ${FONT}`, INK, 'left', W - 160)
  text('All Around Cricket', 80, H - 60, `700 30px ${FONT}`, colour)
  return canvas
}
