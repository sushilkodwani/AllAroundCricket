// A player's "Insights" tab: how they compare with their own team, the moments that swung
// matches, what the team does with and without them, and when and where they play best.
// Everything is worked out from the ball-by-ball score files (see lib/playerInsights.ts).
import { useMemo, type ReactNode } from 'react'
import { DataTable, Insights, Panel, Tiles } from '../components/playerViz'
import { fmtDayMonth } from '../lib/dates'
import { type PlayerCtx, type PlayerData } from '../lib/playerAnalysis'
import { BAT_LINE, MIN_BALLS, bestWorstSr, byTimeOfDay, byVenue, momentText, playerMoments, splitEcon, splitSr, teamRanks, winContribution, type Moment, type RankRow, type SplitRow, type WinCount, type TimeBucket } from '../lib/playerInsights'
import { navigate } from '../state/router'
import { archetypesFor, profileOf, wrappedOf, type Archetype, type Wrapped } from '../lib/playerSeason'
import { buildReport, type Report, type ReportInput } from '../lib/seasonReport'
import { Consistency, YourGame } from './PlayerGame'
import { Partners, Pressure, Rivals } from './PlayerRivals'
import { WICKET_LABELS, type Match, type ScoreFile } from '../types'

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
const show = (v: number | null, digits: number, suffix = '') => (v === null ? '–' : `${v.toFixed(digits)}${suffix}`)
const signed = (n: number, digits = 0) => {
  const r = Number(n.toFixed(digits))
  return `${r > 0 ? '+' : r < 0 ? '–' : ''}${Math.abs(r).toFixed(digits)}`
}
const openMatch = (m: Match | undefined) => m && navigate(`/teams/${m.teamId}/matches/${m.id}/live?tab=scorecard`)

interface Props {
  personId: string
  /** How many badges they have earned, and a way to share the season card (absent: no button). */
  badges?: number
  onShareSeason?: (w: Wrapped, archetypes: Archetype[]) => void
  /** Who the report is for; with this and `onShareReport` the PDF button shows. */
  meta?: ReportInput['meta']
  onShareReport?: (r: Report) => Promise<void>
  /** The player's data for the chosen year. */
  d: PlayerData
  /** The score files for the same set of matches. */
  files: ScoreFile[]
  ctx: PlayerCtx
  personName: (id: string) => string
  matchOf: (id: string) => Match | undefined
}

// ---------- 1. against the team ----------
function RankLine({ r }: { r: RankRow }) {
  const top = r.rank !== null && r.of > 1 && r.rank <= Math.ceil(r.of / 3)
  const max = Math.max(r.value ?? 0, r.team ?? 0, r.best ?? 0, 1e-9)
  const at = (v: number | null) => (v === null ? 0 : Math.min(100, (v / max) * 100))
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{r.label}</span>
        <span className="flex items-baseline gap-2">
          <strong>{show(r.value, r.digits, r.suffix)}</strong>
          {r.rank !== null ? (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${top ? 'border-ok/40 bg-ok/10 text-ok' : 'border-line bg-alt text-muted'}`}>
              {ordinal(r.rank)} of {r.of}
            </span>
          ) : (
            <span className="text-[11px] text-muted">needs {MIN_BALLS}+ balls</span>
          )}
        </span>
      </div>
      <div className="relative h-3 rounded-r bg-alt" role="img" aria-label={`${r.label}: you ${show(r.value, r.digits, r.suffix)}, team average ${show(r.team, r.digits, r.suffix)}, best ${show(r.best, r.digits, r.suffix)}`}>
        <span className="absolute inset-y-0 left-0 rounded-r" style={{ width: `${at(r.value)}%`, minWidth: r.value ? 3 : 0, background: 'var(--series-1)' }} />
        {r.team !== null && <span className="absolute -inset-y-0.5 w-0.5 bg-ink" style={{ left: `${at(r.team)}%` }} aria-hidden />}
      </div>
      <p className="text-[11px] text-muted">
        team average {show(r.team, r.digits, r.suffix)} · best {show(r.best, r.digits, r.suffix)}
        {r.higherIsBetter ? '' : ' (lower is better)'}
      </p>
    </div>
  )
}

function VsTeam({ r }: { r: ReturnType<typeof teamRanks> }) {
  const bat = r.bat.some((x) => x.rank !== null) ? r.bat : []
  const bowl = r.bowl.some((x) => x.rank !== null) ? r.bowl : []
  if (!bat.length && !bowl.length) return null
  return (
    <Panel title="Against the team" sub={`Ranked against the team-mates who have faced or bowled ${MIN_BALLS}+ balls. The black tick is the team average.`}>
      <div className="flex flex-col gap-4">
        {bat.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold">Batting</p>
            {bat.map((x) => (
              <RankLine key={x.key} r={x} />
            ))}
          </div>
        )}
        {bowl.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold">Bowling</p>
            {bowl.map((x) => (
              <RankLine key={x.key} r={x} />
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

// ---------- 2. moments ----------
const KIND_TAG: Record<Moment['kind'], string> = { bat: 'bat', bowl: 'bowl', field: 'field' }

function MomentRow({ m, name, matchOf }: { m: Moment; name: (id: string) => string; matchOf: Props['matchOf'] }) {
  const match = matchOf(m.matchId)
  const up = m.delta >= 0
  return (
    <button type="button" className="row w-full active:bg-alt" onClick={() => openMatch(match)}>
      <span className={`w-[58px] shrink-0 rounded-lg border px-1.5 py-1 text-center text-sm font-bold ${up ? 'border-ok/40 bg-ok/10 text-ok' : 'border-bad/40 bg-bad/10 text-bad'}`}>{signed(m.delta)}%</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm">{momentText(m, name)}</span>
        <span className="block truncate text-xs text-muted">
          {match ? `vs ${match.opponent} · ${fmtDayMonth(match.date)}` : ''} · over {m.at} · {KIND_TAG[m.kind]}
        </span>
      </span>
    </button>
  )
}

function Moments({ files, personId, personName, matchOf }: Pick<Props, 'files' | 'personId' | 'personName' | 'matchOf'>) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const r = useMemo(() => playerMoments(files, personId), [files.map((f) => f.updatedAt).join('|'), personId])
  if (r.matches.length === 0) return null
  const best = [...r.moments].filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3)
  const worst = [...r.moments].filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2)
  const net = r.matches.reduce((s, m) => s + m.total, 0)
  const byMatch = [...r.matches].sort((a, b) => (matchOf(b.matchId)?.date ?? '').localeCompare(matchOf(a.matchId)?.date ?? '')).slice(0, 8)
  const maxAbs = Math.max(1, ...byMatch.map((m) => Math.abs(m.total)))
  return (
    <Panel title="Moments that swung a match" sub="How much each ball of a chase moved the win chance for your side. Tap one for the scorecard.">
      <Tiles
        cols={3}
        items={[
          ['Chases', r.matches.length],
          ['Net swing', `${signed(net)}%`],
          ['Biggest', best[0] ? `${signed(best[0].delta)}%` : '–'],
        ]}
      />
      {best.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-sm font-semibold">Best moments</p>
          <div className="card divide-y divide-line overflow-hidden">
            {best.map((m, i) => (
              <MomentRow key={i} m={m} name={personName} matchOf={matchOf} />
            ))}
          </div>
        </>
      )}
      {worst.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-sm font-semibold">Costliest moments</p>
          <div className="card divide-y divide-line overflow-hidden">
            {worst.map((m, i) => (
              <MomentRow key={i} m={m} name={personName} matchOf={matchOf} />
            ))}
          </div>
        </>
      )}
      <p className="mb-1 mt-3 text-sm font-semibold">Swing in each chase</p>
      <div className="flex flex-col gap-1.5">
        {byMatch.map((m) => {
          const match = matchOf(m.matchId)
          const w = (Math.abs(m.total) / maxAbs) * 50
          return (
            <button key={m.matchId} type="button" className="flex items-center gap-2 text-sm active:bg-alt" onClick={() => openMatch(match)}>
              <span className="w-[92px] shrink-0 truncate text-left text-xs text-muted">{match ? `${match.opponent.split(' ')[0]} · ${fmtDayMonth(match.date)}` : ''}</span>
              <span className="relative h-3.5 flex-1">
                <span className="absolute inset-y-0 left-1/2 w-px bg-line" aria-hidden />
                <span className="absolute inset-y-0 rounded-sm" style={{ width: `${w}%`, minWidth: 2, [m.total >= 0 ? 'left' : 'right']: '50%', background: m.total >= 0 ? 'var(--series-1)' : 'var(--series-2)' }} />
              </span>
              <strong className="w-12 text-right">{signed(m.total)}%</strong>
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-muted">Batting in a chase adds the balls you faced; bowling in a chase adds the balls you bowled. Catches and run outs are listed but not added. This is a rough estimate from the same model as the live win chance, not a prediction, and it only covers second innings.</p>
    </Panel>
  )
}

// ---------- 3. with and without ----------
const pctOf = (c: WinCount) => (c.played > 0 ? Math.round((c.won * 100) / c.played) : null)

function WinRow({ label, c }: { label: ReactNode; c: WinCount }) {
  const p = pctOf(c)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted">
          {c.played === 0 ? 'no matches yet' : `${c.won} of ${c.played} won`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3.5 min-w-0 flex-1 overflow-hidden rounded-r bg-alt">
          <span className="block h-full rounded-r" style={{ width: `${p ?? 0}%`, minWidth: p ? 3 : 0, background: 'var(--series-1)' }} />
        </span>
        <strong className="w-10 text-right text-sm">{p === null ? '–' : `${p}%`}</strong>
      </div>
    </div>
  )
}

function WithWithout({ files, d, personId }: Pick<Props, 'files' | 'd' | 'personId'>) {
  const w = useMemo(() => winContribution(files, d, personId), [files, d, personId])
  if (w.withIn.played === 0) return null
  const a = pctOf(w.withIn)
  const b = pctOf(w.without)
  const sentence = a !== null && b !== null && w.withIn.played >= 3 && w.without.played >= 3 ? (a === b ? `The team wins ${a}% either way.` : `The team wins ${a}% of matches with you and ${b}% without you.`) : null
  const batSplit = w.batHigh.played + w.batLow.played > 0 && (w.batHigh.played > 0 || w.batLow.played > 0)
  const bowlSplit = w.wicket.played + w.noWicket.played > 0
  return (
    <Panel title="The team with and without you" sub="Share of decided matches the team won. Ties and no-results are left out.">
      <div className="flex flex-col gap-3">
        <WinRow label="With you in the XI" c={w.withIn} />
        <WinRow label="Without you" c={w.without} />
        {batSplit && (
          <>
            <WinRow label={`When you score ${BAT_LINE} or more`} c={w.batHigh} />
            <WinRow label={`When you score under ${BAT_LINE}`} c={w.batLow} />
          </>
        )}
        {bowlSplit && (
          <>
            <WinRow label="When you take a wicket" c={w.wicket} />
            <WinRow label="When you take none" c={w.noWicket} />
          </>
        )}
      </div>
      <Insights items={[sentence]} />
      <p className="mt-3 text-xs text-muted">With only a handful of matches these are hints, not proof. Other things change from match to match.</p>
    </Panel>
  )
}

// ---------- 4. when and where ----------
const SHORT: Record<TimeBucket, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening / night' }

function splitTable(rows: SplitRow[], label: (r: SplitRow) => string) {
  return rows.map((r) => [label(r), r.matches, r.inns ? r.runs : '–', show(splitSr(r), 0), r.bowlBalls ? r.wickets : '–', show(splitEcon(r), 1)])
}

function WhenWhere({ d, matchOf }: Pick<Props, 'd' | 'matchOf'>) {
  const info = (id: string) => ({ time: matchOf(id)?.time, venue: matchOf(id)?.venue })
  const time = useMemo(() => byTimeOfDay(d, info), [d, matchOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const venue = useMemo(() => byVenue(d, info), [d, matchOf]) // eslint-disable-line react-hooks/exhaustive-deps
  if (time.length === 0 && venue.length === 0) return null
  const bw = bestWorstSr(time)
  const bv = bestWorstSr(venue)
  const head = ['', 'M', 'Runs', 'SR', 'Wkts', 'Econ']
  return (
    <Panel title="When and where" sub="Your batting and bowling by the match start time and by ground.">
      {time.length > 0 && (
        <>
          <p className="mb-1 text-sm font-semibold">Time of day</p>
          <DataTable head={head} rows={splitTable(time, (r) => SHORT[r.key as TimeBucket])} note={time.length === 1 ? `All your matches here so far started in the ${SHORT[time[0].key as TimeBucket].toLowerCase()}, so there is nothing to compare yet.` : undefined} />
        </>
      )}
      {venue.length > 0 && (
        <>
          <p className="mb-1 mt-4 text-sm font-semibold">Ground</p>
          <DataTable head={head} rows={splitTable(venue, (r) => r.label)} />
        </>
      )}
      <Insights
        items={[
          bw && (
            <>
              You strike at <strong>{show(splitSr(bw.best), 0)}</strong> in {SHORT[bw.best.key as TimeBucket].toLowerCase()} matches, against <strong>{show(splitSr(bw.worst), 0)}</strong> in {SHORT[bw.worst.key as TimeBucket].toLowerCase()} ones.
            </>
          ),
          bv && (
            <>
              Your best ground for batting is <strong>{bv.best.label}</strong> (strike rate {show(splitSr(bv.best), 0)}), your toughest <strong>{bv.worst.label}</strong> ({show(splitSr(bv.worst), 0)}).
            </>
          ),
        ]}
      />
      <p className="mt-3 text-xs text-muted">Needs 2+ innings and 15+ balls in each group before it names a best and a worst. SR = strike rate, Econ = runs per over.</p>
    </Panel>
  )
}

export function InsightsTab(props: Props) {
  const { personId, d, files, ctx, personName, matchOf, badges = 0, onShareSeason, meta, onShareReport } = props
  const nothing = !d.batInns.length && !d.bowlInns.length
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ranks = useMemo(() => teamRanks(files, personId, ctx), [files.map((f) => f.updatedAt).join('|'), personId])
  const archetypes = useMemo(() => archetypesFor(profileOf(d, ranks)), [d, ranks])
  if (nothing) return <p className="card px-4 py-5 text-center text-sm text-muted">Has not batted or bowled in these matches.</p>
  return (
    <div className="flex flex-col gap-4">
      <YourGame
        archetypes={archetypes}
        onShare={onShareSeason && (() => onShareSeason(wrappedOf(d, badges, archetypes), archetypes))}
        onShareReport={meta && onShareReport && (() => onShareReport(buildReport({ d, files, personId, name: personName, matchOf: (id) => matchOf(id), ranks, archetypes, badges, meta })))}
      />
      <VsTeam r={ranks} />
      <Consistency d={d} />
      <Moments files={files} personId={personId} personName={personName} matchOf={matchOf} />
      <Pressure files={files} d={d} personId={personId} />
      <Rivals d={d} personName={personName} />
      <Partners d={d} files={files} personId={personId} personName={personName} />
      <WithWithout files={files} d={d} personId={personId} />
      <WhenWhere d={d} matchOf={matchOf} />
    </div>
  )
}
