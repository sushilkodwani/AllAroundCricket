// Personal goals (e.g. "500 runs this year", "economy under 7"): what each
// metric means and how far along the player is, from their ball-by-ball data.
import type { Goal, GoalMetric } from '../types'
import { avg, batAgg, bowlAgg, econ, inYear, sr, type PlayerData } from './playerAnalysis'

export const MAX_GOALS = 4

export const GOAL_METRICS: { value: GoalMetric; label: string; unit: string; lower?: boolean; decimals?: number; placeholder: string }[] = [
  { value: 'runs', label: 'Runs', unit: 'runs', placeholder: '500' },
  { value: 'wickets', label: 'Wickets', unit: 'wickets', placeholder: '20' },
  { value: 'sixes', label: 'Sixes', unit: 'sixes', placeholder: '25' },
  { value: 'fours', label: 'Fours', unit: 'fours', placeholder: '50' },
  { value: 'fifties', label: '50s', unit: 'fifties', placeholder: '3' },
  { value: 'catches', label: 'Catches', unit: 'catches', placeholder: '10' },
  { value: 'sr', label: 'Strike rate', unit: 'strike rate', decimals: 1, placeholder: '150' },
  { value: 'avg', label: 'Batting average', unit: 'average', decimals: 1, placeholder: '30' },
  { value: 'econ', label: 'Economy', unit: 'economy', lower: true, decimals: 2, placeholder: '7' },
]
export const metricOf = (m: GoalMetric) => GOAL_METRICS.find((x) => x.value === m)!

export function goalTitle(g: Goal): string {
  const m = metricOf(g.metric)
  const when = g.period === 'year' ? ` in ${g.year}` : ' in all'
  if (m.lower) return `Economy of ${g.target} or less${when}`
  if (m.value === 'sr' || m.value === 'avg') return `${m.label} of ${g.target}+${when}`
  return `${g.target} ${m.unit}${when}`
}

export interface GoalProgress {
  /** Where they are now (null: nothing to measure yet, e.g. no balls bowled). */
  value: number | null
  /** 0–1, for the bar. */
  share: number
  done: boolean
  /** "312 of 500", "7.4 (target 7 or less)". */
  text: string
}

/** How far along a goal is. Rates (strike rate, average, economy) count once there is something to measure. */
export function goalProgress(g: Goal, all: PlayerData): GoalProgress {
  const d = g.period === 'year' && g.year ? inYear(all, g.year) : all
  const m = metricOf(g.metric)
  const bat = batAgg(d.batBalls)
  const bowl = bowlAgg(d.bowlBalls)
  const outs = d.batInns.filter((i) => !i.notOut).length
  const value: number | null =
    g.metric === 'runs' ? bat.runs
    : g.metric === 'wickets' ? bowl.wickets
    : g.metric === 'sixes' ? bat.sixes
    : g.metric === 'fours' ? bat.fours
    : g.metric === 'fifties' ? d.batInns.filter((i) => i.runs >= 50).length
    : g.metric === 'catches' ? d.catches.length
    : g.metric === 'sr' ? sr(bat.runs, bat.balls)
    : g.metric === 'avg' ? avg(bat.runs, outs)
    : econ(bowl.runs, bowl.balls)
  const show = (v: number) => (m.decimals ? v.toFixed(m.decimals) : String(v))
  if (value === null) return { value, share: 0, done: false, text: 'Nothing to measure yet' }
  if (m.lower) {
    const done = value <= g.target
    // Closer to the target = fuller bar; twice the target or worse = empty.
    const share = done ? 1 : Math.max(0, Math.min(1, (2 * g.target - value) / g.target))
    return { value, share, done, text: `${show(value)} now (target ${g.target} or less)` }
  }
  const done = value >= g.target
  return { value, share: Math.max(0, Math.min(1, value / g.target)), done, text: m.decimals ? `${show(value)} now (target ${g.target})` : `${value} of ${g.target}` }
}
