// Highlight card: one player's innings or bowling spell in one match, drawn on
// a canvas so it can be shared to WhatsApp like any photo (see resultCard.ts).
import { WICKET_LABELS, type ScoreFile } from '../types'
import { inningsMinutes, mins } from './minutes'
import { BATTER_POS, summarize } from './scorecard'
import { BOWLER_WICKETS, isBall, oversText } from './scoring'

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

export interface HighlightMeta {
  name: string
  team: string
  color?: string
  opponent: string
  date: string
  venue?: string
  jersey?: number
}

export type HighlightKind = 'bat' | 'bowl'

/** Can this player's innings / spell in this match be drawn? */
export function hasHighlight(file: ScoreFile, id: string, kind: HighlightKind): boolean {
  return file.innings.some((_, i) => {
    const s = summarize(file, i)
    return kind === 'bat' ? s.batters.some((b) => b.id === id) : s.bowlers.some((b) => b.id === id && b.balls > 0)
  })
}

export function drawHighlightCard(file: ScoreFile, id: string, kind: HighlightKind, meta: HighlightMeta, nameOf: (id: string) => string): HTMLCanvasElement {
  const idx = file.innings.findIndex((_, i) => {
    const s = summarize(file, i)
    return kind === 'bat' ? s.batters.some((b) => b.id === id) : s.bowlers.some((b) => b.id === id && b.balls > 0)
  })
  if (idx < 0) throw new Error(kind === 'bat' ? 'They did not bat in this match.' : 'They did not bowl in this match.')
  const s = summarize(file, idx)
  const inn = file.innings[idx]
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

  // Header: the player on their team colour.
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, W, 360)
  ctx.fillStyle = 'rgba(255,255,255,0.2)'
  ctx.beginPath()
  ctx.roundRect(80, 80, 200, 200, 40)
  ctx.fill()
  const badge = meta.jersey !== undefined ? String(meta.jersey) : meta.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
  text(badge, 180, 212, `700 88px ${FONT}`, '#FFFFFF', 'center', 180)
  text(meta.name, 320, 160, `700 64px ${FONT}`, '#FFFFFF', 'left', W - 400)
  text(meta.team, 320, 220, `400 36px ${FONT}`, '#FFFFFF', 'left', W - 400)
  text(`vs ${meta.opponent}`, 320, 272, `600 36px ${FONT}`, '#FFFFFF', 'left', W - 400)
  text([meta.date, meta.venue].filter(Boolean).join(' · '), 80, 330, `400 28px ${FONT}`, 'rgba(255,255,255,0.85)', 'left', W - 160)

  const tiles = (items: [string, string][], y: number) => {
    const gap = 24
    const w = (W - 160 - gap * (items.length - 1)) / items.length
    items.forEach(([label, value], i) => {
      const x = 80 + i * (w + gap)
      ctx.fillStyle = '#F4F4F4'
      ctx.beginPath()
      ctx.roundRect(x, y, w, 150, 24)
      ctx.fill()
      text(value, x + w / 2, y + 78, `700 52px ${FONT}`, INK, 'center', w - 20)
      text(label, x + w / 2, y + 122, `400 26px ${FONT}`, MUTED, 'center', w - 20)
    })
  }

  if (kind === 'bat') {
    const b = s.batters.find((x) => x.id === id)!
    const notOut = !b.out
    text(`${b.runs}${notOut ? '*' : ''}`, 80, 560, `800 200px ${FONT}`, INK, 'left', 560)
    text(`(${b.balls} ${b.balls === 1 ? 'ball' : 'balls'})`, 80, 630, `400 40px ${FONT}`, MUTED)
    text(notOut ? 'not out' : 'out', 80, 690, `600 34px ${FONT}`, notOut ? '#1B7F3B' : MUTED)
    const time = inningsMinutes(inn)
    const minutes = time.timed ? time.batters.get(id) : undefined
    tiles(
      [
        ['Strike rate', b.balls ? ((b.runs * 100) / b.balls).toFixed(1) : '–'],
        ['Fours', String(b.fours)],
        ['Sixes', String(b.sixes)],
        ...(minutes ? ([['Minutes', String(mins(minutes))]] as [string, string][]) : []),
      ],
      780,
    )
    // A small wagon wheel of this innings, top right.
    const shots = inn.events.filter(isBall).filter((e) => e.striker === id && e.shot && e.bat > 0 && e.kind !== 'wd')
    if (shots.length) {
      const cx = 820
      const cy = 560
      const r = 170
      ctx.fillStyle = '#B9DCA6'
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2)
      ctx.stroke()
      const bx = cx + BATTER_POS[0] * r
      const by = cy + BATTER_POS[1] * r
      ctx.lineCap = 'round'
      for (const e of [...shots].sort((a, b) => a.bat - b.bat)) {
        ctx.strokeStyle = e.bat === 6 ? '#EB6834' : e.bat === 4 ? '#2A78D6' : 'rgba(17,17,17,0.6)'
        ctx.lineWidth = e.bat >= 4 ? 5 : 3
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.lineTo(cx + e.shot![0] * r * 0.92, cy + e.shot![1] * r * 0.92)
        ctx.stroke()
      }
      ctx.fillStyle = INK
      ctx.beginPath()
      ctx.arc(bx, by, 8, 0, Math.PI * 2)
      ctx.fill()
    }
    const share = s.total ? Math.round((b.runs * 100) / s.total) : 0
    text(`${share}% of the team’s ${s.total} runs`, 80, 1010, `500 36px ${FONT}`, INK)
    if (b.out) text(`Out: ${WICKET_LABELS[b.out.kind]}${b.out.bowler ? ` · bowler ${nameOf(b.out.bowler)}` : ''}`, 80, 1066, `400 32px ${FONT}`, MUTED)
  } else {
    const b = s.bowlers.find((x) => x.id === id)!
    text(`${b.wickets}/${b.runs}`, 80, 560, `800 200px ${FONT}`, INK, 'left', 700)
    text(`(${oversText(b.balls)} overs)`, 80, 630, `400 40px ${FONT}`, MUTED)
    tiles(
      [
        ['Economy', b.balls ? ((b.runs * 6) / b.balls).toFixed(2) : '–'],
        ['Dot balls', String(b.dots)],
        ['Maidens', String(b.maidens)],
        ['Wides', String(b.wides)],
      ],
      720,
    )
    const victims = inn.events.filter(isBall).filter((e) => e.bowler === id && e.wicket && BOWLER_WICKETS.includes(e.wicket.kind))
    if (victims.length) {
      text('Wickets', 80, 960, `700 38px ${FONT}`)
      victims.slice(0, 5).forEach((e, n) => text(`${nameOf(e.wicket!.who)} · ${WICKET_LABELS[e.wicket!.kind]}`, 80, 1016 + n * 50, `400 34px ${FONT}`, INK))
    }
  }

  // Footer: the result and the app name.
  ctx.fillStyle = LINE
  ctx.fillRect(80, H - 170, W - 160, 2)
  text(file.result?.text ?? 'Match in progress', 80, H - 110, `600 32px ${FONT}`, INK, 'left', W - 160)
  text('All Around Cricket', 80, H - 60, `700 30px ${FONT}`, colour)
  return canvas
}
