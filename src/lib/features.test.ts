import { describe, expect, it } from 'vitest'
import type { FundEntry, Match, Person, ScoreFile, Tournament } from '../types'
import { canWrite, type Actor } from './access'
import { awardPoints, chaseView, milestonesOf, parScore, suggestAwards, teamRecords, winChance } from './insights'
import { addBall, newScore, setCrease, startSecondInnings, type BallInput } from './scoring'
import { buildStatement } from './statement'
import { fmtNrr, gameFromMatch, oversToBalls, parseScore, pointsTable } from './tournament'

const XI = (p: string, n = 11) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`)

function game(overs: number, first: (number | BallInput)[], second: (number | BallInput)[] = []): ScoreFile {
  let f = newScore({ matchId: 'm', teamId: 't', overs, home: { name: 'Home', shortName: 'HOM', xi: XI('h') }, away: { name: 'Away', shortName: 'AWY', xi: XI('a') }, toss: { wonBy: 'home', chose: 'bat' } })
  const play = (xs: (number | BallInput)[]) => {
    for (const x of xs) {
      f = addBall(f, typeof x === 'number' ? { bat: x } : x)
      const inn = f.innings[f.innings.length - 1]
      if (inn.closed) continue
      const side = inn.batting === 'home' ? 'h' : 'a'
      const used = new Set(inn.events.flatMap((e) => (e.t === 'ball' ? [e.striker, e.nonStriker] : [])))
      const next = XI(side).find((id) => !used.has(id))
      if (!inn.crease.striker) f = setCrease(f, { striker: next })
      if (!f.innings[f.innings.length - 1].crease.nonStriker) f = setCrease(f, { nonStriker: next })
      const cur = f.innings[f.innings.length - 1]
      if (!cur.crease.bowler) {
        const bowlers = inn.batting === 'home' ? ['a1', 'a2'] : ['h1', 'h2']
        const balls = cur.events.filter((e) => e.t === 'ball' && e.kind === 'legal').length
        f = setCrease(f, { bowler: bowlers[Math.floor(balls / 6) % 2] })
      }
    }
  }
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  play(first)
  if (second.length) {
    f = startSecondInnings(f)
    f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h1' })
    play(second)
  }
  return f
}
const rep = <T,>(x: T, n: number) => Array.from({ length: n }, () => x)

describe('milestones', () => {
  it('fifty, hundred and team fifties on the ball that brings them up', () => {
    // Five overs of sixes: h1 faces overs 1, 3, 5 (108), h2 overs 2, 4 (72).
    const f = game(20, rep(6, 30))
    const list = [...milestonesOf(f, 0).values()].flat()
    expect(list.filter((m) => m.kind === 'fifty')).toEqual([
      { kind: 'fifty', who: 'h1', runs: 54 },
      { kind: 'fifty', who: 'h2', runs: 54 },
    ])
    expect(list.filter((m) => m.kind === 'hundred')).toEqual([{ kind: 'hundred', who: 'h1', runs: 102 }])
    expect(list.filter((m) => m.kind === 'team').map((m) => (m.kind === 'team' ? m.runs : 0))).toEqual([50, 100, 150])
  })
  it('hat-trick on the third wicket in a row, five-for on the fifth', () => {
    const w: BallInput = { wicket: { kind: 'bowled' } }
    const f = game(20, [w, w, w, 0, 0, 0, ...rep(0, 6), w, 0, w])
    const list = [...milestonesOf(f, 0).values()].flat()
    expect(list).toEqual([
      { kind: 'hattrick', who: 'a1' },
      { kind: 'fivefor', who: 'a1' },
    ])
  })
  it('a run out does not count towards a hat-trick', () => {
    const f = game(20, [{ wicket: { kind: 'bowled' } }, { wicket: { kind: 'run_out', who: 'h2' } }, { wicket: { kind: 'bowled' } }, { wicket: { kind: 'bowled' } }])
    expect([...milestonesOf(f, 0).values()].flat()).toEqual([])
  })
})

describe('chase estimate', () => {
  it('par is the required pace', () => {
    expect(parScore(121, 20, 60)).toBe(60)
    expect(parScore(121, 20, 0)).toBe(0)
    expect(parScore(121, 20, 120)).toBe(120)
  })
  it('win chance moves the right way', () => {
    const base = { target: 121, total: 60, ballsLeft: 60, wicketsLeft: 8, wicketsTotal: 10, firstRatePerBall: 1 }
    const p = winChance(base)
    expect(p).toBeGreaterThan(0.3)
    expect(p).toBeLessThan(0.7)
    expect(winChance({ ...base, total: 90 })).toBeGreaterThan(p)
    expect(winChance({ ...base, wicketsLeft: 2 })).toBeLessThan(p)
    expect(winChance({ ...base, ballsLeft: 20 })).toBeLessThan(p)
    expect(winChance({ ...base, total: 121 })).toBe(1)
    expect(winChance({ ...base, wicketsLeft: 0 })).toBe(0)
  })
  it('is shown only during a live chase', () => {
    const first = game(2, rep(1, 12))
    expect(chaseView(first)).toBeNull()
    const chase = game(2, rep(1, 12), [4, 4])
    expect(chaseView(chase)).toMatchObject({ chasing: 'away', par: 2, ahead: 6 })
    expect(chaseView(game(2, rep(1, 12), [6, 6, 1]))).toBeNull() // finished
  })
})

describe('awards', () => {
  // Home 12 (h1 6, h2 6). Away chase: a1 hits 6 6 1 → wins.
  const f = game(2, rep(1, 12), [6, 6, 1])
  it('scores batting, bowling and fielding', () => {
    const pts = new Map(awardPoints(f).map((p) => [p.id, p]))
    expect(pts.get('a1')!.bat).toBe(13 + 4) // 13 runs + 2 sixes × 2
    expect(pts.get('h1')!.bat).toBe(6)
    const caught = game(2, [{ wicket: { kind: 'caught', fielder: 'a5' } }])
    const cp = new Map(awardPoints(caught).map((p) => [p.id, p]))
    expect(cp.get('a5')!.field).toBe(10)
    expect(cp.get('a1')!.bowl).toBe(25)
  })
  it('suggests the top scorers', () => {
    expect(suggestAwards(f)).toMatchObject({ potm: 'a1', batter: 'a1' })
  })
})

describe('records', () => {
  it('finds the best marks of a side', () => {
    const f = game(2, [6, 6, 4, 0, 0, 0, ...rep(1, 6)], [{ wicket: { kind: 'bowled' } }, ...rep(0, 11)])
    const rec = new Map(teamRecords([f], 'home').map((r) => [r.key, r]))
    expect(rec.get('total')!.value).toBe('22/0 (2.0)')
    expect(rec.get('score')!.personIds).toEqual(['h1'])
    expect(rec.get('bowl')).toMatchObject({ value: '1/0', personIds: ['h1'] })
    expect(rec.get('winRuns')!.value).toBe('by 22 runs')
    expect(rec.get('stand')!.value).toBe('22 (12)')
  })
})

describe('tournament table', () => {
  const teams = [
    { id: 'A', name: 'A' },
    { id: 'B', name: 'B' },
    { id: 'C', name: 'C' },
  ]
  const pts = { win: 2, tie: 1, nr: 1 }
  it('points, then net run rate', () => {
    const table = pointsTable(
      teams,
      [
        { a: 'A', b: 'B', aRuns: 120, aBalls: 120, bRuns: 100, bBalls: 120, outcome: 'a' },
        { a: 'B', b: 'C', aRuns: 150, aBalls: 120, bRuns: 90, bBalls: 120, outcome: 'a' },
        { a: 'A', b: 'C', aRuns: 0, aBalls: 0, bRuns: 0, bBalls: 0, outcome: 'nr' },
      ],
      pts,
    )
    expect(table.map((r) => [r.name, r.played, r.points])).toEqual([
      ['A', 2, 3],
      ['B', 2, 2],
      ['C', 2, 1],
    ])
    expect(table[0].nrr).toBeCloseTo(1) // 120/20 − 100/20; the washout is ignored
    expect(table[1].nrr).toBeCloseTo((250 / 40 - 210 / 40) as number)
    expect(fmtNrr(table[2].nrr)).toBe('−3.000')
  })
  it('reads overs and typed scores', () => {
    expect(oversToBalls('18.3')).toBe(111)
    expect(oversToBalls('20')).toBe(120)
    expect(oversToBalls('18.7')).toBeNaN()
    expect(parseScore('154/6 (18.3)')).toEqual({ runs: 154, wickets: 6, balls: 111 })
    expect(parseScore('149')).toEqual({ runs: 149, wickets: undefined, balls: undefined })
  })
  it('a side bowled out is charged the full overs', () => {
    const t = { teams: [{ id: 'us', name: 'Us', teamId: 't' }, { id: 'them', name: 'Lions', opponentId: 'o' }] } as Tournament
    const m = { id: 'm', teamId: 't', opponent: 'Lions', opponentId: 'o', overs: 20, result: 'won', ourScore: '160/5 (20)', theirScore: '90/10 (12.2)', cancelled: false } as Match
    expect(gameFromMatch(t, m)).toEqual({ a: 'us', b: 'them', aRuns: 160, aBalls: 120, bRuns: 90, bBalls: 120, outcome: 'a' })
    expect(gameFromMatch(t, { ...m, result: undefined })).toBeNull()
  })
})

describe('player statement', () => {
  const entry = (p: Partial<FundEntry>): FundEntry => ({ id: Math.random().toString(), teamId: 't', personId: 'p', amount: 0, date: '2026-11-01', type: 'contribution', createdAt: '', updatedAt: '', ...p })
  const funds = [entry({ amount: 1000, method: 'upi' }), entry({ type: 'match_deduction', amount: 300, matchId: 'm1', date: '2026-11-02' }), entry({ type: 'refund', amount: 100, date: '2026-11-05', method: 'cash' })]
  const share = (m: Partial<Match>, s: object): Match => ({ id: 'x', teamId: 't', opponent: 'Lions', date: '2026-11-02', cancelled: false, lifecycle: 'settling', squad: [], expense: { status: 'submitted', lines: [], payerIds: [], roundingExtra: 0, updatedAt: '', shares: [{ personId: 'p', byCategory: {}, total: 0, fromFunds: 0, pending: 0, settled: false, ...s }] }, ...m }) as Match
  const matches = [
    share({ id: 'm1' }, { total: 300, fromFunds: 300, settled: true, settledMethod: 'funds' }),
    share({ id: 'm2', date: '2026-11-03', opponent: 'Tigers' }, { total: 250, pending: 250, settled: true, settledMethod: 'cash' }),
    share({ id: 'm3', date: '2026-11-04', opponent: 'Bears' }, { total: 400, fromFunds: 100, pending: 300 }),
  ]
  it('adds up the money and lists every line in date order', () => {
    const st = buildStatement(funds, matches, 'p')
    expect(st).toMatchObject({ contributed: 1000, refunded: 100, shares: 950, fromFunds: 400, paidDirect: 250, pending: 300, balance: 600, matches: 3 })
    expect(st.lines.map((l) => l.label)).toEqual(['Contribution · UPI', 'vs Lions — share ₹300', 'vs Tigers — share ₹250', 'vs Bears — share ₹400', 'Refund · Cash'])
    expect(st.lines[3]).toMatchObject({ pending: 300, fund: -100 })
  })
})

describe('write guard: availability and scorer', () => {
  const viewer: Actor = { role: 'viewer', personId: 'p1' }
  const av = (entries: object[]) => ({ schemaVersion: 1, entries })
  const mine = { id: 'm:p1', matchId: 'm', personId: 'p1', status: 'in', updatedAt: '' }
  const theirs = { id: 'm:p2', matchId: 'm', personId: 'p2', status: 'in', updatedAt: '' }
  it('a player sets only their own availability', () => {
    expect(canWrite(viewer, 'teams/t/availability.json', av([theirs]), av([theirs, mine]))).toBe(true)
    expect(canWrite(viewer, 'teams/t/availability.json', av([theirs]), av([{ ...theirs, status: 'out' }]))).toBe(false)
    expect(canWrite(viewer, 'teams/t/availability.json', av([theirs, mine]), av([mine]))).toBe(false)
  })

  const scorer: Actor = { ...viewer, scorerMatchIds: ['m1'] }
  const match = (p: Partial<Match>) => ({ id: 'm1', teamId: 't', opponent: 'Lions', date: '2026-11-02', squad: ['p1'], lifecycle: 'scheduled', cancelled: false, ...p }) as Match
  const mf = (...matches: Match[]) => ({ schemaVersion: 1, matches })
  it('a scorer writes the ball log of their match only', () => {
    expect(canWrite(scorer, 'teams/t/scoring/m1.json', null, {})).toBe(true)
    expect(canWrite(scorer, 'teams/t/scoring/m2.json', null, {})).toBe(false)
    expect(canWrite(viewer, 'teams/t/scoring/m1.json', null, {})).toBe(false)
  })
  it('on the match record a scorer changes score fields, nothing else', () => {
    const before = mf(match({}), match({ id: 'm2' }))
    expect(canWrite(scorer, 'teams/t/matches.json', before, mf(match({ scoring: 'finished', result: 'won', ourScore: '10/0 (1.0)' }), match({ id: 'm2' })))).toBe(true)
    expect(canWrite(scorer, 'teams/t/matches.json', before, mf(match({ squad: [] }), match({ id: 'm2' })))).toBe(false)
    expect(canWrite(scorer, 'teams/t/matches.json', before, mf(match({ scorerId: 'p9' }), match({ id: 'm2' })))).toBe(false)
    expect(canWrite(scorer, 'teams/t/matches.json', before, mf(match({}), match({ id: 'm2', result: 'won' })))).toBe(false)
    expect(canWrite(scorer, 'teams/t/matches.json', before, mf(match({})))).toBe(false)
  })
  it('a scorer may add a player without access, never grant access', () => {
    const person = (p: Partial<Person>) => ({ id: 'n', name: 'New', access: 'none', isGuest: true, teamIds: [], createdAt: '', updatedAt: '', ...p }) as Person
    const pf = (...people: Person[]) => ({ schemaVersion: 1, people })
    const old = person({ id: 'o', access: 'view', isGuest: false, teamIds: ['t'] })
    expect(canWrite(scorer, 'people.json', pf(old), pf(old, person({})))).toBe(true)
    expect(canWrite(scorer, 'people.json', pf(old), pf(old, person({ access: 'view' })))).toBe(false)
    expect(canWrite(scorer, 'people.json', pf(old), pf({ ...old, batsLeft: true }))).toBe(true)
    expect(canWrite(scorer, 'people.json', pf(old), pf({ ...old, name: 'Renamed' }))).toBe(false)
    expect(canWrite(scorer, 'teams/t/funds.json', { entries: [] }, { entries: [{}] })).toBe(false)
  })
})
