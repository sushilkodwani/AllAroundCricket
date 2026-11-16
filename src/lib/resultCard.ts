// Result card (PLAN §34): a picture of the match summary, drawn on a canvas
// so it can be shared to WhatsApp like any photo. Nothing leaves the phone
// except through the share sheet the user chooses.
import type { ScoreFile } from '../types'
import { summarize, type InningsSummary } from './scorecard'
import { battingSide, oversText } from './scoring'

const W = 1080
const H = 1350
const RED = '#9B1C1F'
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

export function drawResultCard(file: ScoreFile, nameOf: (id: string) => string, meta: { date: string; venue?: string }): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const text = (s: string, x: number, y: number, font: string, color = INK, align: CanvasTextAlign = 'left', max = W - 160) => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(fit(ctx, s, max), x, y)
  }

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = RED
  ctx.fillRect(0, 0, W, 150)
  text('AllAroundCricket', 80, 95, `700 48px ${FONT}`, '#FFFFFF')
  text([meta.date, meta.venue].filter(Boolean).join(' · '), W - 80, 95, `400 30px ${FONT}`, '#FFFFFF', 'right', 560)

  let y = 250
  const summaries: InningsSummary[] = file.innings.map((_, i) => summarize(file, i))
  file.innings.forEach((inn, i) => {
    const s = summaries[i]
    const won = file.result?.winner === inn.batting
    text(battingSide(file, inn).name, 80, y, `${won ? 700 : 500} 52px ${FONT}`, INK, 'left', 600)
    text(`${s.total}/${s.wickets}`, W - 80, y, `700 64px ${FONT}`, INK, 'right')
    text(`${s.overs} overs`, W - 80, y + 44, `400 30px ${FONT}`, MUTED, 'right')
    y += 130
  })

  ctx.fillStyle = RED
  ctx.fillRect(80, y - 40, W - 160, 96)
  text(file.result?.text ?? 'Match in progress', W / 2, y + 22, `700 42px ${FONT}`, '#FFFFFF', 'center', W - 220)
  y += 140

  // Top two batters and bowlers of each innings.
  file.innings.forEach((inn, i) => {
    const s = summaries[i]
    text(battingSide(file, inn).name, 80, y, `700 32px ${FONT}`, MUTED)
    ctx.fillStyle = LINE
    ctx.fillRect(80, y + 16, W - 160, 2)
    y += 64
    const bat = [...s.batters].sort((a, b) => b.runs - a.runs || a.balls - b.balls).slice(0, 2)
    const bowl = [...s.bowlers].filter((b) => b.balls > 0).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs).slice(0, 2)
    for (let r = 0; r < Math.max(bat.length, bowl.length); r++) {
      const b = bat[r]
      const w = bowl[r]
      if (b) {
        text(nameOf(b.id), 80, y, `500 34px ${FONT}`, INK, 'left', 300)
        text(`${b.runs}${b.out ? '' : '*'} (${b.balls})`, 510, y, `700 34px ${FONT}`, INK, 'right')
      }
      if (w) {
        text(nameOf(w.id), 570, y, `500 34px ${FONT}`, INK, 'left', 240)
        text(`${w.wickets}/${w.runs} (${oversText(w.balls)})`, W - 80, y, `700 34px ${FONT}`, INK, 'right')
      }
      y += 58
    }
    y += 36
  })

  if (file.awards?.potm) {
    ctx.fillStyle = '#F7F7F7'
    ctx.fillRect(80, y - 30, W - 160, 110)
    text('PLAYER OF THE MATCH', 110, y + 12, `600 26px ${FONT}`, MUTED)
    text(`🏆 ${nameOf(file.awards.potm)}`, 110, y + 60, `700 40px ${FONT}`)
  }

  text(`${file[file.toss.wonBy].name} won the toss and chose to ${file.toss.chose} · ${file.overs} overs a side`, W / 2, H - 60, `400 26px ${FONT}`, MUTED, 'center', W - 160)
  return canvas
}

/** Shares the card as a photo where the phone supports it; otherwise downloads it. */
export async function shareResultCard(canvas: HTMLCanvasElement, filename: string, caption: string): Promise<'shared' | 'downloaded'> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not create the image.')
  const file = new File([blob], filename, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: caption })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared' // the user closed the share sheet
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}
