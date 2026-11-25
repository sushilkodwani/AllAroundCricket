// The season report: everything the PDF pages show, gathered from one player's data in one
// pure function (so it can be tested without drawing). The drawing is in reportDraw.ts.
import { WICKET_LABELS, type ScoreFile, type WicketKind } from '../types'
import { fmtDayMonth } from './dates'
import { batAgg, bowlAgg, type PlayerCtx, type PlayerData } from './playerAnalysis'
import {
  BAT_LINE,
  bestWorstSr,
  bowledAt,
  byTimeOfDay,
  byVenue,
  catchDuos,
  clutchOf,
  facedBowlers,
  fastestOff,
  lineEcon,
  lineSr,
  momentText,
  mostOuts,
  partnersOf,
  playerMoments,
  splitEcon,
  splitSr,
  tightOvers,
  winContribution,
  type RankRow,
  type SplitRow,
} from './playerInsights'
import { consistencyOf, wrappedOf, type Archetype, type BatConsistency, type BowlConsistency, type Wrapped } from './playerSeason'
import { phaseProfile } from './season'
import { BALLS } from './scoring'

export interface Bar {
  label: string
  value: number
  /** Small text under or beside the bar (the opponent, "not out"). */
  note?: string
}

export interface Lines {
  title: string
  rows: string[]
}

export interface Report {
  name: string
  team: string
  color?: string
  jersey?: number
  label: string
  wrapped: Wrapped
  archetypes: Archetype[]
  headline: [string, string][]
  ranks: { bat: RankRow[]; bowl: RankRow[] }
  bat: null | {
    perMatch: Bar[]
    average: number
    phases: { label: string; value: number | null; balls: number }[]
    mix: { label: string; value: number }[]
    outs: Bar[]
    consistency: BatConsistency
    partners: { name: string; stands: number; runs: number; balls: number }[]
    best: string
    clutch: string[]
  }
  bowl: null | {
    perMatch: Bar[]
    phases: { label: string; value: number | null; balls: number }[]
    dotPct: number
    kinds: Bar[]
    consistency: BowlConsistency
    best: string
    clutch: string[]
    tight: string | null
  }
  insights: {
    chases: number
    net: number
    best: { text: string; delta: number; when: string }[]
    worst: { text: string; delta: number; when: string }[]
    withWithout: { label: string; played: number; won: number }[]
    time: SplitLine[]
    venue: SplitLine[]
    sentence: string[]
    rivals: Lines[]
    duos: string[]
  }
}

export interface SplitLine {
  label: string
  matches: number
  runs: string
  sr: string
  wickets: string
  econ: string
}

export interface ReportInput {
  d: PlayerData
  files: ScoreFile[]
  personId: string
  name: (id: string) => string
  matchOf: (id: string) => { date: string; opponent: string; time?: string; venue?: string } | undefined
  ranks: { bat: RankRow[]; bowl: RankRow[] }
  archetypes: Archetype[]
  badges: number
  meta: { name: string; team: string; color?: string; jersey?: number }
}

const PHASE_LABEL = { pp: 'Powerplay', mid: 'Middle overs', death: 'Death overs' } as const
const TIME_LABEL: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening / night' }
const times = (n: number) => `${n}×`
const one = (n: number | null) => (n === null ? '–' : n.toFixed(0))

function splitLine(r: SplitRow, label: string): SplitLine {
  const sr = splitSr(r)
  const eco = splitEcon(r)
  return { label, matches: r.matches, runs: r.inns ? String(r.runs) : '–', sr: sr === null ? '–' : sr.toFixed(0), wickets: r.bowlBalls ? String(r.wickets) : '–', econ: eco === null ? '–' : eco.toFixed(1) }
}

const wkLabel = (k: WicketKind) => WICKET_LABELS[k]

export function buildReport(i: ReportInput): Report {
  const { d, files, personId, name } = i
  const wrapped = wrappedOf(d, i.badges, i.archetypes)
  const date = (id: string) => i.matchOf(id)?.date ?? ''
  const day = (iso: string) => (iso ? fmtDayMonth(iso) : '')
  const oldestFirst = <T extends { date: string }>(xs: T[]) => [...xs].sort((a, b) => a.date.localeCompare(b.date))

  // ----- headline numbers -----
  const headline: [string, string][] = [['Matches', String(wrapped.matches)], ['Won', String(wrapped.wins)]]
  if (wrapped.bat) headline.push(['Runs', String(wrapped.bat.runs)])
  if (wrapped.bowl) headline.push(['Wickets', String(wrapped.bowl.wickets)])
  headline.push(['Catches', String(wrapped.catches)])
  if (wrapped.potm > 0) headline.push(['Player of the match', String(wrapped.potm)])
  headline.push(['Badges', String(wrapped.badges)])

  // ----- batting -----
  const ba = batAgg(d.batBalls)
  const prof = phaseProfile(files, personId).filter((p) => p.key !== 'all')
  const consistency = consistencyOf(d)
  const clutch = clutchOf(files, d, personId)
  let bat: Report['bat'] = null
  if (d.batInns.length > 0 && consistency.bat) {
    const perMatch = oldestFirst(d.batInns).slice(-12).map((x) => ({ label: day(x.date), value: x.runs, note: x.notOut ? 'not out' : undefined }))
    const outKinds = new Map<string, number>()
    for (const x of d.batInns) {
      const k = x.out ? wkLabel(x.out.kind) : 'Not out'
      outKinds.set(k, (outKinds.get(k) ?? 0) + 1)
    }
    const dr = lineSr(clutch.death.bat)
    const br = lineSr(clutch.balance.bat)
    bat = {
      perMatch,
      average: ba.outs > 0 ? ba.runs / ba.outs : ba.runs,
      phases: prof.filter((p) => p.bat.balls > 0).map((p) => ({ label: PHASE_LABEL[p.key as keyof typeof PHASE_LABEL], value: p.bat.balls >= 6 ? (p.bat.runs * 100) / p.bat.balls : null, balls: p.bat.balls })),
      mix: [
        { label: 'Dots', value: ba.dots },
        { label: '1s', value: ba.ones },
        { label: '2s', value: ba.twos },
        { label: '3s', value: ba.threes },
        { label: '4s', value: ba.fours },
        { label: '6s', value: ba.sixes },
      ],
      outs: [...outKinds.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      consistency: consistency.bat,
      partners: partnersOf(d).slice(0, 5).map((p) => ({ name: name(p.id), stands: p.stands, runs: p.runs, balls: p.balls })),
      best: wrapped.bat ? `${wrapped.bat.best.runs}${wrapped.bat.best.notOut ? '*' : ''} vs ${wrapped.bat.best.opponent}` : '',
      clutch: [
        clutch.death.bat.balls >= 12 && dr !== null ? `Death overs: strike rate ${one(dr)} (${clutch.death.bat.balls} balls)` : '',
        clutch.balance.bat.balls >= 12 && br !== null ? `Match in the balance: strike rate ${one(br)} (${clutch.balance.bat.balls} balls)` : '',
      ].filter(Boolean),
    }
  }

  // ----- bowling -----
  const bw = bowlAgg(d.bowlBalls)
  let bowl: Report['bowl'] = null
  if (d.bowlInns.length > 0 && consistency.bowl) {
    const byMatch = new Map<string, { date: string; opponent: string; wickets: number; runs: number }>()
    for (const x of d.bowlInns) {
      const m = byMatch.get(x.matchId) ?? { date: x.date, opponent: x.opponent, wickets: 0, runs: 0 }
      m.wickets += x.wickets
      m.runs += x.runs
      byMatch.set(x.matchId, m)
    }
    const kinds = new Map<string, number>()
    for (const b of d.bowlBalls) if (b.wicket) kinds.set(wkLabel(b.wicket), (kinds.get(wkLabel(b.wicket)) ?? 0) + 1)
    const tight = tightOvers(files, personId)
    const de = lineEcon(clutch.death.bowl)
    const be = lineEcon(clutch.balance.bowl)
    bowl = {
      perMatch: oldestFirst([...byMatch.values()]).slice(-12).map((m) => ({ label: day(m.date), value: m.wickets, note: `${m.wickets}/${m.runs}` })),
      phases: prof.filter((p) => p.bowl.balls > 0).map((p) => ({ label: PHASE_LABEL[p.key as keyof typeof PHASE_LABEL], value: p.bowl.balls >= 6 ? (p.bowl.runs * BALLS) / p.bowl.balls : null, balls: p.bowl.balls })),
      dotPct: bw.balls > 0 ? Math.round((bw.dots * 100) / bw.balls) : 0,
      kinds: [...kinds.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      consistency: consistency.bowl,
      best: wrapped.bowl && wrapped.bowl.best.wickets > 0 ? `${wrapped.bowl.best.wickets}/${wrapped.bowl.best.runs} vs ${wrapped.bowl.best.opponent}` : '',
      clutch: [
        clutch.death.bowl.balls >= 12 && de !== null ? `Death overs: economy ${de.toFixed(1)} (${clutch.death.bowl.balls} balls)` : '',
        clutch.balance.bowl.balls >= 12 && be !== null ? `Match in the balance: economy ${be.toFixed(1)} (${clutch.balance.bowl.balls} balls)` : '',
      ].filter(Boolean),
      tight: tight.tight >= 2 ? `${tight.followed} of ${tight.tight} tight overs were followed by a wicket in the next over` : null,
    }
  }

  // ----- insights -----
  const { moments, matches: swings } = playerMoments(files, personId)
  const when = (m: { matchId: string; at: string }) => `${i.matchOf(m.matchId)?.opponent ?? ''} · ${day(date(m.matchId))} · over ${m.at}`
  const line = (m: (typeof moments)[number]) => ({ text: momentText(m, name), delta: m.delta, when: when(m) })
  const w = winContribution(files, d, personId)
  const info = (id: string) => ({ time: i.matchOf(id)?.time, venue: i.matchOf(id)?.venue })
  const time = byTimeOfDay(d, info)
  const venue = byVenue(d, info)
  const bwT = bestWorstSr(time)
  const bwV = bestWorstSr(venue)
  const faced = facedBowlers(d)
  const at = bowledAt(d)
  const rb = (r: { runs: number; balls: number }) => `${r.runs} (${r.balls})`
  const rivals: Lines[] = [
    { title: 'Bowlers who got you out most', rows: mostOuts(faced).map((r) => `${name(r.id)} · ${times(r.outs)} · ${rb(r)}`) },
    { title: 'Bowlers you score fastest off', rows: fastestOff(faced).map((r) => `${name(r.id)} · SR ${((r.runs * 100) / r.balls).toFixed(0)} · ${rb(r)}`) },
    { title: 'Batters you get out most', rows: mostOuts(at).map((r) => `${name(r.id)} · ${times(r.outs)} · ${rb(r)} against`) },
    { title: 'Batters who hit you hardest', rows: fastestOff(at).map((r) => `${name(r.id)} · ${((r.runs * 6) / r.balls).toFixed(1)} an over · ${rb(r)}`) },
  ].filter((x) => x.rows.length > 0)
  const duos = catchDuos(files, personId)
  const list = (xs: { id: string; n: number }[]) => xs.slice(0, 3).map((x) => `${name(x.id)} (${x.n})`).join(', ')
  const withWithout = (w.withIn.played === 0 ? [] : [
    { label: 'With you in the XI', ...w.withIn },
    { label: 'Without you', ...w.without },
    ...(w.batHigh.played + w.batLow.played > 0 ? [{ label: `When you score ${BAT_LINE}+`, ...w.batHigh }, { label: `When you score under ${BAT_LINE}`, ...w.batLow }] : []),
    ...(w.wicket.played + w.noWicket.played > 0 ? [{ label: 'When you take a wicket', ...w.wicket }, { label: 'When you take none', ...w.noWicket }] : []),
  ]).filter((x) => x.played > 0)

  return {
    name: i.meta.name,
    team: i.meta.team,
    color: i.meta.color,
    jersey: i.meta.jersey,
    label: wrapped.label,
    wrapped,
    archetypes: i.archetypes,
    headline,
    ranks: { bat: i.ranks.bat.filter((r) => r.rank !== null), bowl: i.ranks.bowl.filter((r) => r.rank !== null) },
    bat,
    bowl,
    insights: {
      chases: swings.length,
      net: swings.reduce((s, m) => s + m.total, 0),
      best: [...moments].filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3).map(line),
      worst: [...moments].filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2).map(line),
      withWithout,
      time: time.map((r) => splitLine(r, TIME_LABEL[r.key] ?? r.label)),
      venue: venue.slice(0, 6).map((r) => splitLine(r, r.label)),
      sentence: [
        bwT ? `You strike at ${one(splitSr(bwT.best))} in ${(TIME_LABEL[bwT.best.key] ?? '').toLowerCase()} matches, against ${one(splitSr(bwT.worst))} in ${(TIME_LABEL[bwT.worst.key] ?? '').toLowerCase()} ones.` : '',
        bwV ? `Best ground for batting: ${bwV.best.label} (strike rate ${one(splitSr(bwV.best))}); toughest: ${bwV.worst.label} (${one(splitSr(bwV.worst))}).` : '',
      ].filter(Boolean),
      rivals,
      duos: [duos.offMe.length ? `Catches and stumpings off your bowling: ${list(duos.offMe)}` : '', duos.iTookFor.length ? `You took them off the bowling of: ${list(duos.iTookFor)}` : ''].filter(Boolean),
    },
  }
}

/** Which pages the report has: the overview always; the others only when there is something to show. */
export function pagesOf(r: Report): ('overview' | 'batting' | 'bowling' | 'insights')[] {
  const x = r.insights
  const hasInsights = x.best.length + x.worst.length + x.withWithout.length + x.time.length + x.venue.length + x.rivals.length + x.duos.length > 0
  return ['overview', ...(r.bat ? (['batting'] as const) : []), ...(r.bowl ? (['bowling'] as const) : []), ...(hasInsights ? (['insights'] as const) : [])]
}
