// Team → Stats charts: the form strip, the phase breakdown, and a match picker that
// draws the score progression (worm) and runs per over (Manhattan) for one match.
// Plain SVG/HTML from the app's chart kit, so they follow light/dark and fit a phone.
import { useMemo, useState } from 'react'
import { fmtDayMonth } from '../lib/dates'
import { summarize } from '../lib/scorecard'
import { battingSide, other } from '../lib/scoring'
import { formOf, phaseSplit, type FormPoint } from '../lib/teamCharts'
import { navigate } from '../state/router'
import type { Match, ScoreFile, SideKey } from '../types'
import { ChartCard, LineChart, Manhattan, type Series } from './charts'
import { ChoiceChips } from './ui'

const CHIP: Record<FormPoint['result'], string> = {
  W: 'border-ok/40 bg-ok/10 text-ok',
  L: 'border-bad/40 bg-bad/10 text-bad',
  T: 'border-line bg-alt text-muted',
  N: 'border-line bg-alt text-muted',
}
const WORD: Record<FormPoint['result'], string> = { W: 'Won', L: 'Lost', T: 'Tied', N: 'No result' }

/** One chip per finished match, oldest on the left: result letter, the margin and the opponent. Tap for the scorecard. */
export function FormStrip({ files, matches, side }: { files: ScoreFile[]; matches: Match[]; side: SideKey }) {
  const points = useMemo(() => formOf(files, matches, side), [files, matches, side])
  if (points.length === 0) return null
  const last = points.slice(-5).map((p) => p.result).join(' ')
  return (
    <ChartCard title="Form" subtitle={points.length > 1 ? `Last ${Math.min(5, points.length)}: ${last}` : 'Tap a match for its scorecard'}>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {points.map((p) => (
          <button
            key={p.matchId}
            type="button"
            className={`flex w-[84px] shrink-0 flex-col items-center rounded-xl border px-1.5 py-2 text-center active:opacity-70 ${CHIP[p.result]}`}
            aria-label={`${WORD[p.result]} against ${p.opponent}${p.margin ? ` by ${p.margin}` : ''}, ${p.scoreFor} to ${p.scoreAgainst}`}
            onClick={() => navigate(`/teams/${p.teamId}/matches/${p.matchId}/live?tab=scorecard`)}
          >
            <span className="text-xl font-bold leading-none">{p.result}</span>
            <span className="mt-1 text-[11px] font-medium leading-tight">{p.margin || WORD[p.result]}</span>
            <span className="mt-1 w-full truncate text-[11px] text-ink">{p.opponent}</span>
            <span className="text-[10px] text-muted">{p.date ? fmtDayMonth(p.date) : ''}</span>
          </button>
        ))}
      </div>
    </ChartCard>
  )
}

/** Runs per over scored against conceded in the powerplay, middle and death overs, over every scored match. */
export function PhaseChart({ files, side }: { files: ScoreFile[]; side: SideKey }) {
  const rows = useMemo(() => phaseSplit(files, side), [files, side])
  if (rows.length === 0) return null
  const max = Math.max(1, ...rows.flatMap((r) => [r.batRate ?? 0, r.bowlRate ?? 0]))
  const we = side === 'home' ? 'We score' : 'They score'
  const they = side === 'home' ? 'We concede' : 'They concede'
  const bar = (v: number | null, slot: 1 | 2, label: string) => (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-[74px] shrink-0 text-xs text-muted">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="h-3.5 rounded-r" style={{ width: v === null ? 0 : `${(v / max) * 100}%`, minWidth: v ? 3 : 0, maxWidth: 'calc(100% - 40px)', background: `var(--series-${slot})` }} />
        <span className="font-medium">{v === null ? '–' : v.toFixed(1)}</span>
      </span>
    </div>
  )
  return (
    <ChartCard title="Powerplay, middle and death" subtitle="Runs per over in each part of the innings, over all scored matches">
      <div className="flex flex-col gap-4">
        {rows.map((r) => (
          <div key={r.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <strong className="text-sm">{r.label}</strong>
              <span className="text-xs text-muted">
                wickets per match: {r.lost.toFixed(1)} lost · {r.taken.toFixed(1)} taken
              </span>
            </div>
            {bar(r.batRate, 1, we)}
            {bar(r.bowlRate, 2, they)}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Longer bars are better when we score and worse when we concede.</p>
    </ChartCard>
  )
}

/** Pick a match, then see its score progression and runs per over. Newest match first. */
export function MatchGraphs({ files, matches, side }: { files: ScoreFile[]; matches: Match[]; side: SideKey }) {
  const options = useMemo(() => {
    const date = new Map(matches.map((m) => [m.id, m.date]))
    return files
      .filter((f) => f.innings.some((i) => i.events.length > 0))
      .map((f) => ({ f, date: date.get(f.matchId) ?? '' }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.f.matchId.localeCompare(b.f.matchId))
  }, [files, matches])
  const [pick, setPick] = useState<string | undefined>()
  const chosen = options.find((o) => o.f.matchId === pick) ?? options[0]
  const file = chosen?.f
  const series = useMemo(() => {
    if (!file) return null
    const sums = file.innings.map((_, n) => summarize(file, n))
    const base = (x: (typeof sums)[number], n: number) => ({ name: battingSide(file, file.innings[n]).shortName, slot: (file.innings[n].batting === 'home' ? 1 : 2) as 1 | 2, wickets: x.overLines.map((o) => o.wickets) })
    return {
      perOver: sums.map((x, n): Series => ({ ...base(x, n), values: x.overLines.map((o) => o.runs) })),
      worm: sums.map((x, n): Series => ({ ...base(x, n), values: x.overLines.map((o) => o.total) })),
    }
  }, [file])
  if (!file || !series) return null
  const target = file.innings[1]?.target
  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="section-title">Match graphs</h2>
        {options.length > 1 && (
          <ChoiceChips
            row
            options={options.map(({ f, date }) => ({ value: f.matchId, label: `${f[other(side)].name}${date ? ` · ${fmtDayMonth(date)}` : ''}` }))}
            value={file.matchId}
            onChange={setPick}
          />
        )}
      </section>
      <LineChart
        title="Score progression"
        series={series.worm}
        idle="Tap an over to see the score. ● = wicket"
        pace={target ? { label: 'Pace needed in the chase', to: target - 1, overs: file.innings[1].overs } : undefined}
      />
      <Manhattan series={series.perOver} />
    </>
  )
}
