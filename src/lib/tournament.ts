// Tournament maths and storage (PLAN §35): the points table with net run rate.
// A table needs every result of the group, so besides our own matches the
// admin can type in results between other teams.
import type { Match, OtherResult, ScoreFile, Tournament, TournamentsFile, TournamentTeam } from '../types'
import { nowStamp } from './dates'
import { P } from './paths'
import { BALLS, inningsTotal, legalBalls } from './scoring'
import type { Store } from './store'
import { uuid } from './uuid'

/** One finished game between two tournament teams, in the shape the table needs. */
export interface Game {
  a: string
  b: string
  aRuns: number
  /** Balls faced — the full quota if the side was bowled out. 0 = unknown (no NRR effect). */
  aBalls: number
  bRuns: number
  bBalls: number
  outcome: 'a' | 'b' | 'tie' | 'nr'
}

export interface TableRow {
  id: string
  name: string
  played: number
  won: number
  lost: number
  tied: number
  nr: number
  points: number
  nrr: number
}

/** Net run rate = runs scored per over − runs conceded per over, over all completed games. */
export function pointsTable(teams: TournamentTeam[], games: Game[], points: Tournament['points']): TableRow[] {
  const rows = new Map(teams.map((t) => [t.id, { id: t.id, name: t.name, played: 0, won: 0, lost: 0, tied: 0, nr: 0, points: 0, nrr: 0, rf: 0, bf: 0, ra: 0, ba: 0 }]))
  for (const g of games) {
    const a = rows.get(g.a)
    const b = rows.get(g.b)
    if (!a || !b || g.a === g.b) continue
    a.played++
    b.played++
    if (g.outcome === 'nr') {
      a.nr++
      b.nr++
      a.points += points.nr
      b.points += points.nr
      continue // abandoned games do not count towards run rate
    }
    if (g.outcome === 'tie') {
      a.tied++
      b.tied++
      a.points += points.tie
      b.points += points.tie
    } else {
      const [w, l] = g.outcome === 'a' ? [a, b] : [b, a]
      w.won++
      l.lost++
      w.points += points.win
    }
    if (g.aBalls > 0 && g.bBalls > 0) {
      a.rf += g.aRuns
      a.bf += g.aBalls
      a.ra += g.bRuns
      a.ba += g.bBalls
      b.rf += g.bRuns
      b.bf += g.bBalls
      b.ra += g.aRuns
      b.ba += g.aBalls
    }
  }
  return [...rows.values()]
    .map(({ rf, bf, ra, ba, ...row }) => ({ ...row, nrr: bf > 0 && ba > 0 ? (rf * BALLS) / bf - (ra * BALLS) / ba : 0 }))
    .sort((x, y) => y.points - x.points || y.nrr - x.nrr || x.name.localeCompare(y.name))
}

export const fmtNrr = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)}`

/** "18.3" overs → 111 balls. */
export function oversToBalls(text: string): number {
  const [o, b = '0'] = text.trim().split('.')
  const overs = Number(o)
  const balls = Number(b[0] ?? 0)
  if (!Number.isInteger(overs) || overs < 0 || !Number.isInteger(balls) || balls < 0 || balls >= BALLS) return NaN
  return overs * BALLS + balls
}

/** "154/6 (18.3)" or "154-6 in 18.3" → runs, wickets, balls. */
export function parseScore(text?: string): { runs: number; wickets?: number; balls?: number } | null {
  if (!text) return null
  const m = text.match(/(\d+)\s*(?:[/-]\s*(\d+))?(?:\D+(\d+(?:\.\d)?))?/)
  if (!m) return null
  const balls = m[3] ? oversToBalls(m[3]) : undefined
  return { runs: Number(m[1]), wickets: m[2] ? Number(m[2]) : undefined, balls: balls !== undefined && !Number.isNaN(balls) ? balls : undefined }
}

/** The tournament team a side of one of our matches maps to. */
function teamOf(t: Tournament, match: Match, ours: boolean): string | undefined {
  if (ours) return t.teams.find((x) => x.teamId === match.teamId)?.id
  return t.teams.find((x) => (match.opponentId ? x.opponentId === match.opponentId : false) || x.name.toLowerCase() === match.opponent.toLowerCase())?.id
}

/** Turns one of our matches into a table game; null while it has no result. */
export function gameFromMatch(t: Tournament, match: Match, score?: ScoreFile | null): Game | null {
  if (match.cancelled || !match.result) return null
  const a = teamOf(t, match, true)
  const b = teamOf(t, match, false)
  if (!a || !b) return null
  const outcome: Game['outcome'] = match.result === 'won' ? 'a' : match.result === 'lost' ? 'b' : match.result === 'tied' ? 'tie' : 'nr'
  const game: Game = { a, b, aRuns: 0, aBalls: 0, bRuns: 0, bBalls: 0, outcome }
  if (outcome === 'nr') return game

  if (score && score.status === 'finished') {
    score.innings.forEach((inn, idx) => {
      // A side bowled out is charged its full quota of overs.
      const balls = inn.closed === 'all_out' ? inn.overs * BALLS : legalBalls(inn)
      if (inn.batting === 'home') [game.aRuns, game.aBalls] = [inningsTotal(score, idx), balls]
      else [game.bRuns, game.bBalls] = [inningsTotal(score, idx), balls]
    })
    return game
  }
  // No ball-by-ball score: use the typed score lines, when they include overs.
  const quota = (match.overs ?? 0) * BALLS
  const side = (text?: string) => {
    const s = parseScore(text)
    if (!s) return null
    const balls = s.wickets === 10 && quota ? quota : (s.balls ?? 0)
    return balls > 0 ? { runs: s.runs, balls } : null
  }
  const ours = side(match.ourScore)
  const theirs = side(match.theirScore)
  if (ours && theirs) [game.aRuns, game.aBalls, game.bRuns, game.bBalls] = [ours.runs, ours.balls, theirs.runs, theirs.balls]
  return game
}

export const gameFromOther = (r: OtherResult): Game => ({ a: r.a, b: r.b, aRuns: r.aRuns, aBalls: r.aBalls, bRuns: r.bRuns, bBalls: r.bBalls, outcome: r.outcome })

// ---------- storage ----------
export const tournamentsOf = (s: Store) => s.get<TournamentsFile>(P.tournaments)?.tournaments ?? []
const put = (s: Store, tournaments: Tournament[], msg: string) => s.write(P.tournaments, { schemaVersion: 1, tournaments }, msg)

function patch(s: Store, id: string, fn: (t: Tournament) => Tournament, msg: string): void {
  put(s, tournamentsOf(s).map((t) => (t.id === id ? { ...fn(t), updatedAt: nowStamp() } : t)), msg)
}

export function createTournament(s: Store, name: string): Tournament {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!clean) throw new Error('Enter a name.')
  if (tournamentsOf(s).some((t) => !t.archived && t.name.toLowerCase() === clean.toLowerCase())) throw new Error('A tournament with this name already exists.')
  const now = nowStamp()
  const t: Tournament = { id: uuid(), name: clean, points: { win: 2, tie: 1, nr: 1 }, teams: [], otherResults: [], archived: false, createdBy: s.actor.personId, createdAt: now, updatedAt: now }
  put(s, [...tournamentsOf(s), t], `Create tournament ${clean}`)
  return t
}

/** Deletes a tournament. Its matches stay; they just no longer count towards a table. Only its creator (or the super admin). */
export function deleteTournament(s: Store, id: string): void {
  const t = tournamentsOf(s).find((x) => x.id === id)
  if (!t) return
  if (!put(s, tournamentsOf(s).filter((x) => x.id !== id), `Delete tournament ${t.name}`)) throw new Error('Only the admin who created this tournament can delete it.')
}

export function updateTournament(s: Store, id: string, change: Partial<Pick<Tournament, 'name' | 'points' | 'archived'>>): void {
  patch(s, id, (t) => ({ ...t, ...change }), 'Edit tournament')
}

/** Adds a team to the table unless it is already there (matched by link or by name). */
export function addTournamentTeam(s: Store, id: string, team: Omit<TournamentTeam, 'id'>): void {
  const name = team.name.trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!name) throw new Error('Enter the team name.')
  patch(
    s,
    id,
    (t) => {
      const exists = t.teams.some((x) => (team.teamId && x.teamId === team.teamId) || (team.opponentId && x.opponentId === team.opponentId) || x.name.toLowerCase() === name.toLowerCase())
      return exists ? t : { ...t, teams: [...t.teams, { ...team, name, id: uuid() }] }
    },
    `Add ${name} to tournament`,
  )
}

export function removeTournamentTeam(s: Store, id: string, teamId: string): void {
  patch(s, id, (t) => ({ ...t, teams: t.teams.filter((x) => x.id !== teamId), otherResults: t.otherResults.filter((r) => r.a !== teamId && r.b !== teamId) }), 'Remove team from tournament')
}

/** Both sides of one of our matches join the table when the match is put in a tournament. */
export function enrolMatchTeams(s: Store, id: string, match: Match, ourName: string): void {
  addTournamentTeam(s, id, { name: ourName, teamId: match.teamId })
  addTournamentTeam(s, id, { name: match.opponent, opponentId: match.opponentId })
}

export function saveOtherResult(s: Store, id: string, input: Omit<OtherResult, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): void {
  if (!input.a || !input.b || input.a === input.b) throw new Error('Pick two different teams.')
  if (input.outcome !== 'nr') {
    const nums = [input.aRuns, input.aBalls, input.bRuns, input.bBalls]
    if (!nums.every((n) => Number.isInteger(n) && n >= 0)) throw new Error('Enter runs and overs for both teams (overs like 20 or 18.3).')
    if (input.aBalls === 0 || input.bBalls === 0) throw new Error('Enter the overs each team batted.')
  }
  const now = nowStamp()
  patch(
    s,
    id,
    (t) => ({
      ...t,
      otherResults: input.id ? t.otherResults.map((r) => (r.id === input.id ? { ...r, ...input, id: r.id, updatedAt: now } : r)) : [...t.otherResults, { ...input, id: uuid(), createdAt: now, updatedAt: now }],
    }),
    'Save tournament result',
  )
}

export function deleteOtherResult(s: Store, id: string, resultId: string): void {
  patch(s, id, (t) => ({ ...t, otherResults: t.otherResults.filter((r) => r.id !== resultId) }), 'Delete tournament result')
}
