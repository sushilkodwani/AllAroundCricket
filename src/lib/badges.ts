// Badges and milestones on a player's profile. Worked out from the score files
// in date order, so each badge knows the match it was earned in; nothing is
// stored. Count badges (100 runs, 10 wickets …) also report progress.
import type { ScoreFile } from '../types'
import { milestonesOf } from './insights'
import { summarize } from './scorecard'
import { isBall, squadOf } from './scoring'

export type BadgeGroup = 'batting' | 'bowling' | 'fielding' | 'match'

export interface Badge {
  id: string
  icon: string
  name: string
  /** What it takes, e.g. "Score 50 in an innings". */
  how: string
  group: BadgeGroup
  /** When it was first earned (null = not yet). */
  earned: { date: string; matchId: string } | null
  /** How many times it has been earned (feats) — 0 when not yet. */
  times: number
  /** Count badges: how far along (have of need). */
  progress?: { have: number; need: number }
}

interface Def {
  id: string
  icon: string
  name: string
  how: string
  group: BadgeGroup
  /** Count badges: the running total and the target. */
  need?: number
  total?: keyof Totals
}

interface Totals {
  runs: number
  sixes: number
  fours: number
  wickets: number
  catches: number
  matches: number
  potm: number
}

const DEFS: Def[] = [
  // batting feats (one innings)
  { id: 'thirty', icon: '🏏', name: 'Cool thirty', how: 'Score 30 in an innings', group: 'batting' },
  { id: 'fifty', icon: '⭐', name: 'Half-century', how: 'Score 50 in an innings', group: 'batting' },
  { id: 'hundred', icon: '💯', name: 'Century', how: 'Score 100 in an innings', group: 'batting' },
  { id: 'quickfire', icon: '⚡', name: 'Quick-fire', how: '25+ runs at a strike rate of 200 or more', group: 'batting' },
  { id: 'sixhitter', icon: '🚀', name: 'Six machine', how: 'Hit 3 sixes in an innings', group: 'batting' },
  { id: 'anchor', icon: '⚓', name: 'Anchor', how: 'Face 40 balls in an innings', group: 'batting' },
  { id: 'finisher', icon: '🏁', name: 'Finisher', how: 'Not out at the end of a winning chase', group: 'batting' },
  // batting careers
  { id: 'runs100', icon: '🥉', name: '100 runs', how: 'Score 100 runs in all', group: 'batting', need: 100, total: 'runs' },
  { id: 'runs250', icon: '🥈', name: '250 runs', how: 'Score 250 runs in all', group: 'batting', need: 250, total: 'runs' },
  { id: 'runs500', icon: '🥇', name: '500 runs', how: 'Score 500 runs in all', group: 'batting', need: 500, total: 'runs' },
  { id: 'runs1000', icon: '🏆', name: '1,000 runs', how: 'Score 1,000 runs in all', group: 'batting', need: 1000, total: 'runs' },
  { id: 'sixes25', icon: '💥', name: '25 sixes', how: 'Hit 25 sixes in all', group: 'batting', need: 25, total: 'sixes' },
  { id: 'fours50', icon: '🎯', name: '50 fours', how: 'Hit 50 fours in all', group: 'batting', need: 50, total: 'fours' },
  // bowling feats
  { id: 'firstwicket', icon: '☝️', name: 'First wicket', how: 'Take a wicket', group: 'bowling' },
  { id: 'threefor', icon: '🔥', name: 'Three-for', how: 'Take 3 wickets in an innings', group: 'bowling' },
  { id: 'fivefor', icon: '🖐️', name: 'Five-for', how: 'Take 5 wickets in an innings', group: 'bowling' },
  { id: 'hattrick', icon: '🎩', name: 'Hat-trick', how: 'Wickets with three balls in a row', group: 'bowling' },
  { id: 'maiden', icon: '🧱', name: 'Maiden over', how: 'Bowl an over without giving a run', group: 'bowling' },
  { id: 'miser', icon: '🔒', name: 'Miser', how: '2+ overs at 4 runs an over or less', group: 'bowling' },
  { id: 'wkts10', icon: '🎳', name: '10 wickets', how: 'Take 10 wickets in all', group: 'bowling', need: 10, total: 'wickets' },
  { id: 'wkts25', icon: '🌪️', name: '25 wickets', how: 'Take 25 wickets in all', group: 'bowling', need: 25, total: 'wickets' },
  // fielding
  { id: 'catches5', icon: '🧤', name: 'Safe hands', how: 'Take 5 catches in all', group: 'fielding', need: 5, total: 'catches' },
  { id: 'catches15', icon: '🦅', name: 'Catching machine', how: 'Take 15 catches in all', group: 'fielding', need: 15, total: 'catches' },
  { id: 'runout', icon: '🎯', name: 'Direct hit', how: 'Run a batter out', group: 'fielding' },
  { id: 'stumping', icon: '⚡', name: 'Lightning gloves', how: 'Make a stumping', group: 'fielding' },
  // matches and awards
  { id: 'matches10', icon: '📅', name: '10 matches', how: 'Play 10 scored matches', group: 'match', need: 10, total: 'matches' },
  { id: 'matches25', icon: '🗓️', name: '25 matches', how: 'Play 25 scored matches', group: 'match', need: 25, total: 'matches' },
  { id: 'potm', icon: '🏅', name: 'Player of the match', how: 'Be named player of the match', group: 'match' },
  { id: 'potm5', icon: '👑', name: 'Match-winner', how: 'Player of the match 5 times', group: 'match', need: 5, total: 'potm' },
]

export const BADGE_COUNT = DEFS.length

/** Every badge for this player, earned or not, in catalogue order. */
export function badgesOf(files: ScoreFile[], id: string, dateOf: (matchId: string) => string): Badge[] {
  const out = new Map<string, Badge>(DEFS.map((d) => [d.id, { id: d.id, icon: d.icon, name: d.name, how: d.how, group: d.group, earned: null, times: 0, progress: d.need ? { have: 0, need: d.need } : undefined }]))
  const totals: Totals = { runs: 0, sixes: 0, fours: 0, wickets: 0, catches: 0, matches: 0, potm: 0 }
  const ordered = [...files].sort((a, b) => (dateOf(a.matchId) || a.startedAt).localeCompare(dateOf(b.matchId) || b.startedAt))

  for (const file of ordered) {
    const date = dateOf(file.matchId) || file.startedAt.slice(0, 10)
    const at = { date, matchId: file.matchId }
    const hit = (key: string) => {
      const b = out.get(key)!
      b.times++
      if (!b.earned) b.earned = at
    }
    const side = squadOf(file.home).includes(id) ? 'home' : squadOf(file.away).includes(id) ? 'away' : null
    if (!side) continue
    totals.matches++
    if (file.awards?.potm === id) {
      totals.potm++
      hit('potm')
    }

    file.innings.forEach((inn, idx) => {
      const s = summarize(file, idx)
      const bat = s.batters.find((b) => b.id === id)
      if (bat) {
        totals.runs += bat.runs
        totals.sixes += bat.sixes
        totals.fours += bat.fours
        if (bat.runs >= 30) hit('thirty')
        if (bat.runs >= 50) hit('fifty')
        if (bat.runs >= 100) hit('hundred')
        if (bat.runs >= 25 && bat.balls > 0 && bat.runs * 100 >= 200 * bat.balls) hit('quickfire')
        if (bat.sixes >= 3) hit('sixhitter')
        if (bat.balls >= 40) hit('anchor')
        const won = file.status === 'finished' && file.result?.winner === side
        if (idx === 1 && inn.batting === side && won && !bat.out && !bat.retiredHurt && bat.balls > 0) hit('finisher')
      }
      const bowl = s.bowlers.find((b) => b.id === id)
      if (bowl && bowl.balls > 0) {
        totals.wickets += bowl.wickets
        if (bowl.wickets >= 1) hit('firstwicket')
        if (bowl.wickets >= 3) hit('threefor')
        if (bowl.wickets >= 5) hit('fivefor')
        if (bowl.maidens > 0) hit('maiden')
        if (bowl.balls >= 12 && bowl.runs * 6 <= 4 * bowl.balls) hit('miser')
      }
      for (const list of milestonesOf(file, idx).values()) for (const m of list) if (m.kind === 'hattrick' && m.who === id) hit('hattrick')
      for (const e of inn.events) {
        if (!isBall(e) || !e.wicket) continue
        const w = e.wicket
        const fielder = w.kind === 'caught_bowled' ? e.bowler : w.fielder
        if (fielder !== id) continue
        if (w.kind === 'caught' || w.kind === 'caught_behind' || w.kind === 'caught_bowled') totals.catches++
        if (w.kind === 'run_out') hit('runout')
        if (w.kind === 'stumped') hit('stumping')
      }
    })

    // Count badges: earned in the match where the running total first reaches the target.
    for (const d of DEFS) {
      if (!d.need || !d.total) continue
      const b = out.get(d.id)!
      b.progress = { have: Math.min(totals[d.total], d.need), need: d.need }
      if (!b.earned && totals[d.total] >= d.need) {
        b.earned = at
        b.times = 1
      }
    }
  }
  return [...out.values()]
}

/** Earned badges, latest first. */
export const earnedBadges = (badges: Badge[]) => badges.filter((b) => b.earned).sort((a, b) => b.earned!.date.localeCompare(a.earned!.date))
