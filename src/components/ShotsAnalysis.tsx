// Shots analysis: for a set of balls (a player's career, one team's innings,
// one batter against one bowler …) the runs, dots, boundaries and dismissals
// from each kind of shot, as sticker tiles with All / Out / Dots / 1s / 2s and
// 3s / 4s / 6s filters. Only balls where the scorer recorded the shot count.
import { useState } from 'react'
import { SHOT_LABELS, type ShotType } from '../types'
import { FilterChips } from './playerViz'
import { ShotTiles } from './ShotIcons'

/** What a ball needs for this: the shot, runs off the bat, whether it was faced, and a dismissal. */
export interface ShotBall {
  shotType?: ShotType
  bat: number
  faced: boolean
  out?: unknown
}

export type ShotFilter = 'all' | 'out' | 'dots' | 'ones' | 'twos' | 'fours' | 'sixes'
export const SHOT_FILTERS: { value: ShotFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'out', label: 'Out' },
  { value: 'dots', label: 'Dots' },
  { value: 'ones', label: '1s' },
  { value: 'twos', label: '2s and 3s' },
  { value: 'fours', label: '4s' },
  { value: 'sixes', label: '6s' },
]

export interface ShotRow {
  type: ShotType
  runs: number
  balls: number
  outs: number
  dots: number
  ones: number
  twosThrees: number
  fours: number
  sixes: number
}

/** Totals for each shot played, most runs first. */
export function shotRows(balls: ShotBall[]): ShotRow[] {
  const m = new Map<ShotType, ShotRow>()
  for (const b of balls) {
    if (!b.shotType) continue
    let r = m.get(b.shotType)
    if (!r) m.set(b.shotType, (r = { type: b.shotType, runs: 0, balls: 0, outs: 0, dots: 0, ones: 0, twosThrees: 0, fours: 0, sixes: 0 }))
    if (b.out) r.outs++
    if (!b.faced) continue
    r.balls++
    r.runs += b.bat
    if (b.bat === 0) r.dots++
    else if (b.bat === 1) r.ones++
    else if (b.bat === 2 || b.bat === 3) r.twosThrees += b.bat
    else if (b.bat === 4) r.fours++
    else if (b.bat === 6) r.sixes++
  }
  return [...m.values()].sort((a, b) => b.runs - a.runs || b.balls - a.balls)
}

const valueOf = (r: ShotRow, f: ShotFilter) => (f === 'all' ? r.runs : f === 'out' ? r.outs : f === 'dots' ? r.dots : f === 'ones' ? r.ones : f === 'twos' ? r.twosThrees : f === 'fours' ? r.fours : r.sixes)
const UNIT: Record<ShotFilter, [string, string]> = { all: ['run', 'runs'], out: ['time out', 'times out'], dots: ['dot ball', 'dot balls'], ones: ['single', 'singles'], twos: ['run', 'runs'], fours: ['four', 'fours'], sixes: ['six', 'sixes'] }

/** Filter chips and sticker tiles for these balls; nothing when no shot was recorded. */
export function ShotsBreakdown({ balls, left }: { balls: ShotBall[]; left?: boolean }) {
  const [filter, setFilter] = useState<ShotFilter>('all')
  const rows = shotRows(balls)
  if (!rows.length) return <p className="py-3 text-center text-sm text-muted">No shots recorded. Turn on “Ask the shot played” when scoring.</p>
  const tiles = rows
    .map((r) => {
      const v = valueOf(r, filter)
      return { type: r.type, n: v, value: `${v} ${UNIT[filter][v === 1 ? 0 : 1]}`, note: `${SHOT_LABELS[r.type]}: ${r.runs} runs off ${r.balls} balls, ${r.fours} fours, ${r.sixes} sixes${r.outs ? `, out ${r.outs} ${r.outs === 1 ? 'time' : 'times'}` : ''}.` }
    })
    .filter((t) => t.n > 0)
    .sort((a, b) => b.n - a.n)
  return (
    <div>
      <FilterChips options={SHOT_FILTERS} value={filter} onChange={setFilter} />
      <ShotTiles left={left} rows={tiles} />
    </div>
  )
}
