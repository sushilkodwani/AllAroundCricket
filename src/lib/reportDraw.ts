// Draws the season report as A4 pages on canvases (browser only). The numbers come from
// seasonReport.ts; this file only lays them out: headline tiles, bars, tables and lists.
import { pagesOf, type Bar, type Report, type SplitLine } from './seasonReport'

const PW = 827 // page size in drawing units (A4 at about 100 dpi) ...
const PH = 1169
const SCALE = 2 // ... drawn at twice that, so print stays sharp
const M = 48
const CW = PW - 2 * M
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

const INK = '#111111'
const MUTED = '#6B6B6B'
const LINE = '#E3E3E0'
const TILE = '#F4F4F2'
const BLUE = '#2A78D6'
const ORANGE = '#EB6834'
const GREEN = '#1B7F3B'
const RED = '#C0392B'
const MIX_COLORS: Record<string, string> = { Dots: '#C9C9C6', '1s': '#2A78D6', '2s': '#1BAF7A', '3s': '#EDA100', '4s': '#EB6834', '6s': '#6250D6' }

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
const signed = (n: number) => {
  const r = Math.round(n)
  return `${r > 0 ? '+' : r < 0 ? '–' : ''}${Math.abs(r)}%`
}

class Page {
  readonly canvas = document.createElement('canvas')
  readonly ctx: CanvasRenderingContext2D
  y = M

  constructor() {
    this.canvas.width = PW * SCALE
    this.canvas.height = PH * SCALE
    this.ctx = this.canvas.getContext('2d')!
    this.ctx.scale(SCALE, SCALE)
    this.ctx.fillStyle = '#FFFFFF'
    this.ctx.fillRect(0, 0, PW, PH)
  }

  /** Is there room for `h` more units above the footer? */
  room(h: number) {
    return this.y + h <= PH - 70
  }

  text(str: string, x: number, y: number, size: number, o: { weight?: number; color?: string; align?: CanvasTextAlign; max?: number } = {}) {
    const { ctx } = this
    ctx.font = `${o.weight ?? 400} ${size}px ${FONT}`
    ctx.fillStyle = o.color ?? INK
    ctx.textAlign = o.align ?? 'left'
    ctx.textBaseline = 'alphabetic'
    let t = str
    if (o.max && ctx.measureText(t).width > o.max) {
      while (t.length > 1 && ctx.measureText(`${t}…`).width > o.max) t = t.slice(0, -1)
      t = `${t}…`
    }
    ctx.fillText(t, x, y)
  }

  rect(x: number, y: number, w: number, h: number, fill: string, r = 0) {
    this.ctx.fillStyle = fill
    this.ctx.beginPath()
    if (r > 0) this.ctx.roundRect(x, y, w, h, r)
    else this.ctx.rect(x, y, w, h)
    this.ctx.fill()
  }

  hline(y: number, x0 = M, x1 = PW - M, color = LINE) {
    this.rect(x0, y, x1 - x0, 1, color)
  }

  /** A section title with an optional one-line explanation. */
  section(title: string, sub?: string) {
    this.y += 10
    this.text(title, M, this.y + 16, 17, { weight: 700 })
    this.y += 24
    if (sub) {
      this.text(sub, M, this.y + 12, 10.5, { color: MUTED, max: CW })
      this.y += 18
    }
    this.y += 6
  }

  /** Wrapped paragraph; returns nothing, moves y. */
  para(str: string, size = 11, color = MUTED, x = M, width = CW) {
    const words = str.split(/\s+/)
    let line = ''
    this.ctx.font = `400 ${size}px ${FONT}`
    for (const w of words) {
      const next = line ? `${line} ${w}` : w
      if (this.ctx.measureText(next).width > width && line) {
        this.text(line, x, this.y + size, size, { color })
        this.y += size + 5
        line = w
      } else line = next
    }
    if (line) {
      this.text(line, x, this.y + size, size, { color })
      this.y += size + 5
    }
  }

  /** Big-number tiles in rows of `perRow`. */
  tiles(items: [string, string][], perRow = 4) {
    const gap = 10
    const w = (CW - gap * (perRow - 1)) / perRow
    items.forEach(([label, value], i) => {
      const col = i % perRow
      if (col === 0 && i > 0) this.y += 76
      const x = M + col * (w + gap)
      this.rect(x, this.y, w, 66, TILE, 10)
      this.text(value, x + w / 2, this.y + 33, 24, { weight: 700, align: 'center', max: w - 12 })
      this.text(label, x + w / 2, this.y + 54, 10, { color: MUTED, align: 'center', max: w - 10 })
    })
    this.y += 76
  }

  /** Columns for each bar, oldest on the left, with the value above and the label below; a dashed average line. */
  vbars(bars: Bar[], color: string, o: { average?: number; height?: number; avgLabel?: string } = {}) {
    const h = o.height ?? 130
    if (bars.length === 0) return
    const max = Math.max(1, ...bars.map((b) => b.value), o.average ?? 0)
    const slot = CW / Math.max(bars.length, 6)
    const bw = Math.min(40, slot - 8)
    const base = this.y + h + 18
    const x0 = M + (CW - slot * bars.length) / 2
    this.hline(base, M, PW - M)
    bars.forEach((b, i) => {
      const bh = Math.max(b.value > 0 ? 3 : 1, (b.value / max) * h)
      const x = x0 + i * slot + (slot - bw) / 2
      this.rect(x, base - bh, bw, bh, color, 3)
      this.text(`${b.value}${b.note === 'not out' ? '*' : ''}`, x + bw / 2, base - bh - 4, 11, { weight: 600, align: 'center' })
      this.text(b.label, x + bw / 2, base + 13, 9, { color: MUTED, align: 'center', max: slot })
    })
    if (o.average !== undefined && o.average > 0) {
      const ay = base - (o.average / max) * h
      this.ctx.save()
      this.ctx.strokeStyle = INK
      this.ctx.lineWidth = 1
      this.ctx.setLineDash([4, 3])
      this.ctx.beginPath()
      this.ctx.moveTo(M, ay)
      this.ctx.lineTo(PW - M, ay)
      this.ctx.stroke()
      this.ctx.restore()
      this.text(o.avgLabel ?? `average ${o.average.toFixed(1)}`, PW - M, ay - 4, 9.5, { color: MUTED, align: 'right' })
    }
    this.y = base + 24
  }

  /** Horizontal bars with a label on the left and the value at the tip. */
  hbars(rows: { label: string; value: number; text?: string }[], color: string, o: { max?: number; labelW?: number } = {}) {
    const lw = o.labelW ?? 150
    const max = Math.max(1e-9, o.max ?? Math.max(...rows.map((r) => r.value)))
    const bx = M + lw
    const span = CW - lw - 70
    for (const r of rows) {
      this.text(r.label, M, this.y + 13, 11.5, { max: lw - 8 })
      const w = Math.max(r.value > 0 ? 3 : 0, (r.value / max) * span)
      this.rect(bx, this.y + 2, w, 15, color, 3)
      this.text(r.text ?? String(r.value), bx + w + 6, this.y + 14, 11.5, { weight: 600 })
      this.y += 24
    }
  }

  /** One stacked bar split into coloured parts, with a legend showing counts and shares. */
  stacked(parts: { label: string; value: number }[]) {
    const total = parts.reduce((s, p) => s + p.value, 0)
    if (total === 0) return
    let x = M
    for (const p of parts.filter((q) => q.value > 0)) {
      const w = (p.value / total) * CW
      this.rect(x, this.y, Math.max(1, w - 1.5), 22, MIX_COLORS[p.label] ?? BLUE, 3)
      x += w
    }
    this.y += 34
    let lx = M
    for (const p of parts) {
      const t = `${p.label} ${p.value} (${Math.round((p.value * 100) / total)}%)`
      this.rect(lx, this.y + 3, 10, 10, MIX_COLORS[p.label] ?? BLUE, 2)
      this.text(t, lx + 15, this.y + 12, 10.5)
      lx += 15 + this.ctx.measureText(t).width + 16
    }
    this.y += 24
  }

  table(head: string[], rows: string[][], widths: number[]) {
    let x = M
    head.forEach((h, i) => {
      this.text(h, i === 0 ? x : x + widths[i], this.y + 12, 10, { color: MUTED, weight: 600, align: i === 0 ? 'left' : 'right' })
      x += widths[i]
    })
    this.y += 18
    for (const r of rows) {
      this.hline(this.y)
      x = M
      r.forEach((c, i) => {
        this.text(c, i === 0 ? x : x + widths[i], this.y + 16, 11.5, { weight: i === 0 ? 600 : 400, align: i === 0 ? 'left' : 'right', max: i === 0 ? widths[0] - 8 : widths[i] })
        x += widths[i]
      })
      this.y += 23
    }
  }

  /** The top band of a page and the footer. */
  frame(r: Report, title: string, n: number, of: number, big: boolean) {
    const colour = r.color ?? '#9B1C1F'
    const h = big ? 190 : 78
    this.rect(0, 0, PW, h, colour)
    if (big) {
      this.rect(M, 40, 96, 96, 'rgba(255,255,255,0.2)', 20)
      const badge = r.jersey !== undefined ? String(r.jersey) : r.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
      this.text(badge, M + 48, 104, 44, { weight: 700, color: '#FFFFFF', align: 'center', max: 90 })
      this.text(r.name, M + 120, 78, 32, { weight: 700, color: '#FFFFFF', max: CW - 120 })
      this.text(r.team, M + 120, 106, 17, { color: '#FFFFFF', max: CW - 120 })
      this.text(`${r.label} · ${r.wrapped.matches} ${r.wrapped.matches === 1 ? 'match' : 'matches'}`, M + 120, 134, 15, { weight: 600, color: 'rgba(255,255,255,0.9)', max: CW - 120 })
      this.y = h + 14
    } else {
      this.text(title, M, 48, 24, { weight: 700, color: '#FFFFFF' })
      this.text(`${r.name} · ${r.label}`, PW - M, 48, 13, { color: 'rgba(255,255,255,0.9)', align: 'right', max: CW - 160 })
      this.y = h + 6
    }
    this.hline(PH - 44, M, PW - M)
    this.text(`${r.name} · ${r.label}`, M, PH - 24, 10.5, { color: MUTED, max: CW - 220 })
    this.text(`All Around Cricket · page ${n} of ${of}`, PW - M, PH - 24, 10.5, { color: colour, weight: 600, align: 'right' })
  }
}

// ---------- pages ----------
function overview(p: Page, r: Report) {
  const colour = r.color ?? '#9B1C1F'
  if (r.archetypes.length > 0) {
    // The kind of player, as pills in the header.
    let x = PW - M
    for (const a of [...r.archetypes].reverse()) {
      p.ctx.font = `700 13px ${FONT}`
      const w = p.ctx.measureText(a.label).width + 28
      x -= w
      p.rect(x, 150, w, 26, '#FFFFFF', 13)
      p.text(a.label, x + w / 2, 168, 13, { weight: 700, color: colour, align: 'center', max: w - 12 })
      x -= 8
    }
  }
  p.tiles(r.headline, 4)

  const ranked = (title: string, rows: Report['ranks']['bat']) => {
    if (!rows.length) return
    p.text(title, M, p.y + 13, 12.5, { weight: 700 })
    p.y += 22
    for (const row of rows) {
      if (!p.room(32)) return
      const max = Math.max(row.value ?? 0, row.team ?? 0, row.best ?? 0, 1e-9)
      const bx = M + 140
      const bw = 300
      const val = row.value === null ? '–' : `${row.value.toFixed(row.digits)}${row.suffix ?? ''}`
      p.text(row.label, M, p.y + 13, 11.5)
      p.rect(bx, p.y + 3, bw, 11, TILE, 3)
      if (row.value !== null) p.rect(bx, p.y + 3, Math.max(3, (row.value / max) * bw), 11, BLUE, 3)
      if (row.team !== null) p.rect(bx + (row.team / max) * bw - 1, p.y, 2, 17, INK)
      p.text(val, bx + bw + 56, p.y + 14, 12, { weight: 700, align: 'right' })
      const top = row.rank !== null && row.of > 1 && row.rank <= Math.ceil(row.of / 3)
      p.text(row.rank === null ? '' : `${ordinal(row.rank)} of ${row.of}`, PW - M, p.y + 14, 11.5, { weight: 600, color: top ? GREEN : MUTED, align: 'right' })
      p.y += 26
    }
    p.y += 6
  }
  if (r.ranks.bat.length + r.ranks.bowl.length > 0) {
    p.section('Against the team', 'Ranked against team-mates with 12+ balls faced or bowled. The black tick is the team average.')
    ranked('Batting', r.ranks.bat)
    ranked('Bowling (for economy and average, lower is better)', r.ranks.bowl)
  }

  const best: string[] = []
  if (r.bat?.best) best.push(`Best innings: ${r.bat.best}`)
  if (r.bowl?.best) best.push(`Best spell: ${r.bowl.best}`)
  if (best.length && p.room(60)) {
    p.section('Best performances')
    for (const b of best) {
      p.text(b, M, p.y + 16, 16, { weight: 700 })
      p.y += 26
    }
  }
  const chips = (label: string, items: { top: string; sub: string }[]) => {
    if (!items.length || !p.room(80)) return
    p.text(label, M, p.y + 13, 12.5, { weight: 700 })
    p.y += 22
    const w = 78
    items.slice(0, Math.floor((CW + 8) / (w + 8))).forEach((c, i) => {
      const x = M + i * (w + 8)
      p.rect(x, p.y, w, 48, TILE, 8)
      p.text(c.top, x + w / 2, p.y + 25, 17, { weight: 700, align: 'center', max: w - 8 })
      p.text(c.sub, x + w / 2, p.y + 40, 9, { color: MUTED, align: 'center', max: w - 6 })
    })
    p.y += 60
  }
  if (r.bat || r.bowl) {
    p.section('Recent form', 'Latest first. * = not out.')
    if (r.bat) chips('Batting', [...r.bat.perMatch].reverse().map((b) => ({ top: `${b.value}${b.note === 'not out' ? '*' : ''}`, sub: b.label })))
    if (r.bowl) chips('Bowling (wickets / runs)', [...r.bowl.perMatch].reverse().map((b) => ({ top: b.note ?? String(b.value), sub: b.label })))
  }
  if (r.archetypes.length && p.room(40 + r.archetypes.length * 40)) {
    p.section('Your game')
    for (const a of r.archetypes) {
      p.text(a.label, M, p.y + 14, 13, { weight: 700 })
      p.y += 19
      p.para(a.why, 11)
      p.y += 4
    }
  }
}

function batting(p: Page, r: Report) {
  const b = r.bat!
  p.section('Runs in each match', `Last ${b.perMatch.length} innings, oldest first. * = not out. The dashed line is your average (${b.average.toFixed(1)}).`)
  p.vbars(b.perMatch, BLUE, { average: b.average, height: 120, avgLabel: `average ${b.average.toFixed(1)}` })

  if (b.phases.length > 0 && p.room(120)) {
    p.section('Strike rate by phase', 'Runs per 100 balls in each part of the innings (needs 6+ balls).')
    p.hbars(b.phases.map((x) => ({ label: `${x.label} (${x.balls} balls)`, value: x.value ?? 0, text: x.value === null ? '–' : x.value.toFixed(0) })), BLUE, { labelW: 190 })
  }
  if (p.room(110)) {
    p.section('How the balls went', 'Every ball you faced.')
    p.stacked(b.mix)
  }
  if (b.outs.length > 0 && p.room(40 + b.outs.length * 24)) {
    p.section('How you got out')
    p.hbars(b.outs.map((x) => ({ label: x.label, value: x.value })), ORANGE, { labelW: 150 })
  }
  const c = b.consistency
  if (p.room(150)) {
    p.section('Consistency', `A start is ${15}+ runs; "went on" means 30+.`)
    p.tiles(
      [
        ['Median score', String(Math.round(c.median))],
        ['Best / worst', `${c.best} / ${c.worst}`],
        [`15+ scores`, `${c.starts} of ${c.innings}`],
        ['Style', c.label ?? '–'],
      ],
      4,
    )
    if (c.starts >= 3) p.text(`You turn ${Math.round((c.kickedOn * 100) / c.starts)}% of your 15+ starts into 30+.`, M, p.y + 12, 11.5, { color: MUTED })
    p.y += 20
  }
  if (b.clutch.length && p.room(60)) {
    p.section('Under pressure')
    for (const l of b.clutch) {
      p.text(l, M, p.y + 13, 12)
      p.y += 20
    }
  }
  if (b.partners.length && p.room(60 + b.partners.length * 24)) {
    p.section('Batting partners', 'By runs together.')
    p.table(['Partner', 'Stands', 'Runs', 'Balls'], b.partners.map((x) => [x.name, String(x.stands), String(x.runs), String(x.balls)]), [320, 140, 135, 136])
  }
}

function bowling(p: Page, r: Report) {
  const b = r.bowl!
  p.section('Wickets in each match', `Last ${b.perMatch.length} matches, oldest first.`)
  p.vbars(b.perMatch.map((x) => ({ ...x, note: undefined })), ORANGE, { height: 110 })
  if (b.phases.length > 0 && p.room(120)) {
    p.section('Economy by phase', 'Runs per over in each part of the innings (needs 6+ balls). Lower is better.')
    p.hbars(b.phases.map((x) => ({ label: `${x.label} (${x.balls} balls)`, value: x.value ?? 0, text: x.value === null ? '–' : x.value.toFixed(1) })), ORANGE, { labelW: 190 })
  }
  if (p.room(90)) {
    p.section('Dot balls')
    p.text(`${b.dotPct}%`, M, p.y + 30, 34, { weight: 800 })
    p.text('of the balls you bowled went for no run', M + 110, p.y + 28, 12, { color: MUTED })
    p.y += 46
  }
  if (b.kinds.length > 0 && p.room(40 + b.kinds.length * 24)) {
    p.section('How your wickets fell')
    p.hbars(b.kinds.map((x) => ({ label: x.label, value: x.value })), BLUE, { labelW: 150 })
  }
  const c = b.consistency
  if (p.room(130)) {
    p.section('Consistency')
    p.tiles([['Spells', String(c.innings)], ['Took a wicket', `${c.withWicket} of ${c.innings}`], ['10+ an over', String(c.expensive)]], 4)
  }
  const lines = [...b.clutch, ...(b.tight ? [b.tight] : [])]
  if (lines.length && p.room(60 + lines.length * 20)) {
    p.section('Under pressure')
    for (const l of lines) {
      p.text(l, M, p.y + 13, 12, { max: CW })
      p.y += 20
    }
  }
}

function splitTable(p: Page, title: string, rows: SplitLine[]) {
  if (!rows.length || !p.room(50 + rows.length * 23)) return
  p.text(title, M, p.y + 13, 12.5, { weight: 700 })
  p.y += 22
  p.table(['', 'M', 'Runs', 'SR', 'Wkts', 'Econ'], rows.map((x) => [x.label, String(x.matches), x.runs, x.sr, x.wickets, x.econ]), [300, 70, 100, 90, 90, 81])
  p.y += 6
}

function insights(p: Page, r: Report) {
  const x = r.insights
  if (x.best.length + x.worst.length > 0) {
    p.section('Moments that swung a match', `Change in your side's chance of winning, ball by ball, in ${x.chases} chase${x.chases === 1 ? '' : 's'}. Net swing ${signed(x.net)}. A rough estimate, not a prediction.`)
    for (const [title, rows, good] of [['Best', x.best, true], ['Costliest', x.worst, false]] as const) {
      if (!rows.length || !p.room(30 + rows.length * 40)) continue
      p.text(title, M, p.y + 13, 12.5, { weight: 700 })
      p.y += 22
      for (const m of rows) {
        p.rect(M, p.y, 58, 28, good ? 'rgba(27,127,59,0.12)' : 'rgba(192,57,43,0.12)', 8)
        p.text(signed(m.delta), M + 29, p.y + 19, 13, { weight: 700, color: good ? GREEN : RED, align: 'center' })
        p.text(m.text, M + 70, p.y + 12, 12.5, { weight: 600, max: CW - 70 })
        p.text(m.when, M + 70, p.y + 26, 10, { color: MUTED, max: CW - 70 })
        p.y += 40
      }
    }
  }
  if (x.withWithout.length && p.room(60 + x.withWithout.length * 26)) {
    p.section('The team with and without you', 'Share of decided matches won. A handful of matches only gives hints.')
    p.hbars(x.withWithout.map((w) => ({ label: w.label, value: Math.round((w.won * 100) / w.played), text: `${Math.round((w.won * 100) / w.played)}%  (${w.won} of ${w.played})` })), BLUE, { max: 100, labelW: 190 })
  }
  if ((x.time.length || x.venue.length) && p.room(120)) {
    p.section('When and where', 'Your batting and bowling by match start time and by ground.')
    splitTable(p, 'Time of day', x.time)
    splitTable(p, 'Ground', x.venue)
    for (const s of x.sentence) if (p.room(24)) p.para(s, 11, INK)
  }
  for (const rv of x.rivals) {
    if (!p.room(40 + rv.rows.length * 20)) break
    if (rv === x.rivals[0]) p.section('Rivals')
    p.text(rv.title, M, p.y + 13, 12.5, { weight: 700 })
    p.y += 20
    for (const row of rv.rows) {
      p.text(row, M + 8, p.y + 13, 11.5, { max: CW - 8 })
      p.y += 19
    }
    p.y += 6
  }
  if (x.duos.length && p.room(50 + x.duos.length * 20)) {
    p.section('Catching duos')
    for (const d of x.duos) {
      p.text(d, M, p.y + 13, 11.5, { max: CW })
      p.y += 20
    }
  }
}

/** One A4 canvas per page of the report. */
export function drawReportPages(r: Report): HTMLCanvasElement[] {
  const kinds = pagesOf(r)
  return kinds.map((kind, i) => {
    const p = new Page()
    p.frame(r, kind === 'overview' ? '' : kind === 'batting' ? 'Batting' : kind === 'bowling' ? 'Bowling' : 'Insights', i + 1, kinds.length, kind === 'overview')
    if (kind === 'overview') overview(p, r)
    else if (kind === 'batting') batting(p, r)
    else if (kind === 'bowling') bowling(p, r)
    else insights(p, r)
    return p.canvas
  })
}
