import { describe, expect, it } from 'vitest'
import type { ScoreFile } from '../types'
import { ballNumbers, ballText, ballToken, shotRegion, summarize } from './scorecard'
import { addBall, addToXi, editBall, endInnings, inningsTotal, isFreeHit, newScore, penalty, retire, setCrease, setOvers, setTarget, startSecondInnings, swapStrike, undo, type BallInput } from './scoring'

const H = ['h1', 'h2', 'h3', 'h4']
const A = ['a1', 'a2', 'a3', 'a4']

function start(overs = 2): ScoreFile {
  let f = newScore({
    matchId: 'm',
    teamId: 't',
    overs,
    home: { name: 'Home', shortName: 'HOM', xi: H },
    away: { name: 'Away', shortName: 'AWY', xi: A },
    toss: { wonBy: 'home', chose: 'bat' },
  })
  f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
  return f
}
const balls = (f: ScoreFile, ...inputs: (number | BallInput)[]) => inputs.reduce<ScoreFile>((acc, x) => addBall(acc, typeof x === 'number' ? { bat: x } : x), f)
const inn = (f: ScoreFile) => f.innings[f.innings.length - 1]

describe('setup', () => {
  it('the toss decides who bats first', () => {
    expect(start().innings[0].batting).toBe('home')
    const f = newScore({ matchId: 'm', teamId: 't', overs: 5, home: { name: 'H', shortName: 'H', xi: H }, away: { name: 'A', shortName: 'A', xi: A }, toss: { wonBy: 'home', chose: 'bowl' } })
    expect(f.innings[0].batting).toBe('away')
  })
  it('refuses a player in both XIs and a one-player side', () => {
    const side = (xi: string[]) => ({ name: 'X', shortName: 'X', xi })
    expect(() => newScore({ matchId: 'm', teamId: 't', overs: 5, home: side(['p', 'q']), away: side(['p', 'r']), toss: { wonBy: 'home', chose: 'bat' } })).toThrow(/both/)
    expect(() => newScore({ matchId: 'm', teamId: 't', overs: 5, home: side(['p']), away: side(['q', 'r']), toss: { wonBy: 'home', chose: 'bat' } })).toThrow(/at least 2/)
  })
  it('needs batters and a bowler before a ball', () => {
    const f = newScore({ matchId: 'm', teamId: 't', overs: 5, home: { name: 'H', shortName: 'H', xi: H }, away: { name: 'A', shortName: 'A', xi: A }, toss: { wonBy: 'home', chose: 'bat' } })
    expect(() => addBall(f, { bat: 1 })).toThrow(/batters/)
  })
})

describe('strike and overs', () => {
  it('odd runs swap the strike, even runs do not', () => {
    let f = balls(start(), 1)
    expect(inn(f).crease.striker).toBe('h2')
    f = balls(f, 2)
    expect(inn(f).crease.striker).toBe('h2')
    f = balls(f, 3)
    expect(inn(f).crease.striker).toBe('h1')
  })
  it('the over ends after six legal balls: strike swaps and a new bowler is needed', () => {
    const f = balls(start(), 0, 0, 0, 0, 0, 0)
    expect(inn(f).crease).toEqual({ striker: 'h2', nonStriker: 'h1', bowler: undefined })
    expect(() => addBall(f, { bat: 0 })).toThrow(/bowler/)
    expect(() => setCrease(f, { bowler: 'a1' })).toThrow(/two overs in a row/)
    expect(inn(setCrease(f, { bowler: 'a2' })).crease.bowler).toBe('a2')
  })
  it('a single off the last ball keeps that batter on strike', () => {
    const f = balls(start(), 0, 0, 0, 0, 0, 1)
    expect(inn(f).crease.striker).toBe('h1')
  })
  it('wides and no-balls do not count towards the over', () => {
    const f = balls(start(), { kind: 'wd' }, { kind: 'nb', bat: 4 }, 0, 0, 0, 0, 0)
    expect(inn(f).crease.bowler).toBe('a1')
    const s = summarize(f, 0)
    expect(s.overs).toBe('0.5')
    expect(s.total).toBe(6)
  })
  it('swap strike by hand', () => {
    expect(inn(swapStrike(start())).crease.striker).toBe('h2')
  })
})

describe('extras', () => {
  it('books each kind where it belongs', () => {
    const f = balls(
      start(),
      { kind: 'wd' }, // 1 wide
      { kind: 'wd', byes: 2 }, // 3 wides
      { kind: 'nb', bat: 2 }, // 1 nb + 2 to the batter
      { kind: 'nb', byes: 1, byeType: 'lb' }, // 1 nb + 1 leg bye
      { byes: 4, byeType: 'b' }, // 4 byes
      { byes: 1, byeType: 'lb' }, // 1 leg bye
    )
    const s = summarize(f, 0)
    expect(s.extras).toEqual({ wd: 4, nb: 2, b: 4, lb: 2, pen: 0, total: 12 })
    expect(s.total).toBe(14)
    const bowler = s.bowlers[0]
    // Charged to the bowler: wides 4, no-balls 2, runs off the bat 2 — byes and leg-byes are not.
    expect(bowler.runs).toBe(8)
    expect(bowler.balls).toBe(2)
    expect(bowler.wides).toBe(4)
    expect(bowler.noBalls).toBe(2)
    const h1 = s.batters.find((b) => b.id === 'h1')!
    const h2 = s.batters.find((b) => b.id === 'h2')!
    // A wide is not a ball faced; a no-ball is.
    expect(h1.runs + h2.runs).toBe(2)
    expect(h1.balls + h2.balls).toBe(4)
  })
  it('a wide with an odd number of runs swaps the strike', () => {
    expect(inn(balls(start(), { kind: 'wd', byes: 1 })).crease.striker).toBe('h2')
  })
  it('free hit follows a no-ball and survives a wide', () => {
    let f = balls(start(), { kind: 'nb' })
    expect(isFreeHit(inn(f))).toBe(true)
    f = balls(f, { kind: 'wd' })
    expect(isFreeHit(inn(f))).toBe(true)
    expect(() => addBall(f, { wicket: { kind: 'bowled' } })).toThrow(/free hit/)
    f = balls(f, { wicket: { kind: 'run_out', who: 'h1', fielder: 'a1' } })
    expect(isFreeHit(inn(f))).toBe(false)
  })
  it('no bowled off a no-ball, no lbw off a wide', () => {
    expect(() => addBall(start(), { kind: 'nb', wicket: { kind: 'bowled' } })).toThrow(/no-ball/)
    expect(() => addBall(start(), { kind: 'wd', wicket: { kind: 'lbw' } })).toThrow(/wide/)
    expect(summarize(addBall(start(), { kind: 'wd', wicket: { kind: 'stumped', fielder: 'a2' } }), 0).wickets).toBe(1)
  })
  it('penalty runs go to either side', () => {
    let f = penalty(start(), 5, 'batting')
    expect(inningsTotal(f, 0)).toBe(5)
    f = balls(f, 0, 0, 0, 0, 0, 0)
    f = setCrease(f, { bowler: 'a2' })
    f = endInnings(balls(f, 1))
    f = startSecondInnings(f)
    expect(inn(f).target).toBe(7)
    f = penalty(f, 5, 'fielding') // to the side that batted first
    expect(inningsTotal(f, 0)).toBe(11)
    expect(inn(f).target).toBe(12)
    expect(summarize(f, 0).extras.pen).toBe(10)
  })
})

describe('wickets', () => {
  it('bowled: the striker goes, the bowler gets it', () => {
    const f = balls(start(), { wicket: { kind: 'bowled' } })
    expect(inn(f).crease).toEqual({ striker: undefined, nonStriker: 'h2', bowler: 'a1' })
    const s = summarize(f, 0)
    expect(s.wickets).toBe(1)
    expect(s.bowlers[0].wickets).toBe(1)
    expect(s.fow).toEqual([{ n: 1, score: 0, who: 'h1', over: '0.1' }])
    expect(() => setCrease(f, { striker: 'h1' })).toThrow(/already out/)
    expect(inn(setCrease(f, { striker: 'h3' })).crease.striker).toBe('h3')
  })
  it('run out of the non-striker after one run: the bowler gets no wicket', () => {
    const f = balls(start(), { bat: 1, wicket: { kind: 'run_out', who: 'h2', fielder: 'a3' } })
    // They crossed: h2 was heading to the striker's end.
    expect(inn(f).crease).toEqual({ striker: undefined, nonStriker: 'h1', bowler: 'a1' })
    const s = summarize(f, 0)
    expect(s.total).toBe(1)
    expect(s.bowlers[0].wickets).toBe(0)
    expect(s.batters.find((b) => b.id === 'h2')!.out).toEqual({ kind: 'run_out', bowler: 'a1', fielder: 'a3' })
  })
  it('caught off the last ball of the over: new batter goes to the non-striker’s end', () => {
    const f = balls(start(), 0, 0, 0, 0, 0, { wicket: { kind: 'caught', fielder: 'a2' } })
    expect(inn(f).crease).toEqual({ striker: 'h2', nonStriker: undefined, bowler: undefined })
  })
  it('all out when one batter is left', () => {
    let f = balls(start(), { wicket: { kind: 'bowled' } })
    f = setCrease(f, { striker: 'h3' })
    f = balls(f, { wicket: { kind: 'lbw' } })
    f = setCrease(f, { striker: 'h4' })
    expect(f.status).toBe('live')
    f = balls(f, { wicket: { kind: 'bowled' } })
    expect(inn(f).closed).toBe('all_out')
    expect(f.status).toBe('break')
    expect(() => addBall(f, { bat: 1 })).toThrow(/over/)
  })
  it('retired hurt is not a wicket and the batter can return; retired out is a wicket', () => {
    let f = retire(start(), 'h1', false)
    expect(summarize(f, 0).wickets).toBe(0)
    f = setCrease(f, { striker: 'h3' })
    f = balls(f, 1)
    expect(summarize(f, 0).batters.find((b) => b.id === 'h1')!.retiredHurt).toBe(true)
    f = retire(f, 'h3', true)
    expect(summarize(f, 0).wickets).toBe(1)
    f = setCrease(f, { nonStriker: 'h1' }) // h1 comes back
    expect(summarize(f, 0).batters.find((b) => b.id === 'h1')!.retiredHurt).toBe(false)
  })
})

describe('innings and result', () => {
  function firstInnings(): ScoreFile {
    // 2 overs: 1 1 1 1 1 1 | 4 4 0 0 0 0 = 14
    let f = balls(start(), 1, 1, 1, 1, 1, 1)
    f = setCrease(f, { bowler: 'a2' })
    f = balls(f, 4, 4, 0, 0, 0, 0)
    return f
  }
  it('closes after the overs and sets the target', () => {
    let f = firstInnings()
    expect(inn(f).closed).toBe('overs')
    expect(f.status).toBe('break')
    f = startSecondInnings(f)
    expect(inn(f).batting).toBe('away')
    expect(inn(f).target).toBe(15)
    expect(f.status).toBe('live')
  })
  it('chasing side wins by wickets the moment the target is reached', () => {
    let f = startSecondInnings(firstInnings())
    f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h1' })
    f = balls(f, 6, 6, { wicket: { kind: 'bowled' } })
    f = setCrease(f, { striker: 'a3' })
    f = balls(f, 4)
    expect(f.status).toBe('finished')
    expect(inn(f).closed).toBe('target')
    expect(f.result).toEqual({ winner: 'away', text: 'Away won by 2 wickets' })
    const s = summarize(f, 1)
    expect(s.need).toEqual({ runs: 0, balls: 8, rate: 0 })
  })
  it('side batting first wins by runs; equal scores tie', () => {
    let f = startSecondInnings(firstInnings())
    f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h1' })
    f = balls(f, 1, 1, 1, 1, 1, 1)
    f = setCrease(f, { bowler: 'h2' })
    const lost = balls(f, 1, 1, 1, 0, 0, 0)
    expect(lost.result).toEqual({ winner: 'home', text: 'Home won by 5 runs' })
    const tied = balls(f, 4, 4, 0, 0, 0, 0)
    expect(tied.result).toEqual({ text: 'Match tied' })
  })
  it('reduced overs and a revised target', () => {
    let f = balls(start(5), 1, 1, 1, 1, 1, 1)
    expect(() => setOvers(f, 0)).toThrow()
    f = setOvers(f, 1)
    expect(inn(f).closed).toBe('overs')
    expect(f.overs).toBe(1)
    f = setTarget(startSecondInnings(f), 5)
    expect(inn(f).target).toBe(5)
    f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h1' })
    f = balls(f, 4, 1)
    expect(f.result?.winner).toBe('away')
  })
})

describe('corrections', () => {
  it('undo restores the batters, the bowler and an ended over', () => {
    const before = balls(start(), 0, 0, 0, 0, 0)
    const after = balls(before, 1)
    expect(inn(after).crease.bowler).toBeUndefined()
    const back = undo(after)
    expect(inn(back).crease).toEqual(inn(before).crease)
    expect(inn(back).events).toHaveLength(5)
  })
  it('undo takes back a wicket even after the next batter was picked', () => {
    let f = balls(start(), { wicket: { kind: 'bowled' } })
    f = setCrease(f, { striker: 'h3' })
    f = undo(f)
    expect(inn(f).crease).toEqual({ striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
    expect(summarize(f, 0).wickets).toBe(0)
  })
  it('undo reopens a finished match and steps back through the innings break', () => {
    let f = balls(start(1), 0, 0, 0, 0, 0, 2)
    f = startSecondInnings(f)
    f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h1' })
    f = balls(f, 4)
    expect(f.status).toBe('finished')
    f = undo(f)
    expect(f.status).toBe('live')
    expect(f.result).toBeUndefined()
    f = undo(f) // nothing bowled in the chase → back to the break
    expect(f.innings).toHaveLength(1)
    expect(f.status).toBe('break')
    f = undo(f)
    expect(f.status).toBe('live')
    expect(inn(f).events).toHaveLength(5)
  })
  it('undo of "end innings" just reopens it', () => {
    const f = undo(endInnings(balls(start(), 1)))
    expect(inn(f).closed).toBeUndefined()
    expect(inn(f).events).toHaveLength(1)
  })
  it('editing an earlier ball recalculates totals and the target', () => {
    let f = balls(start(1), 1, 0, 0, 0, 0, 0)
    const id = inn(f).events[0].id
    f = startSecondInnings(f)
    expect(inn(f).target).toBe(2)
    f = editBall(f, 0, id, { bat: 0, byes: 4, byeType: 'lb' })
    expect(inn(f).target).toBe(5)
    const s = summarize(f, 0)
    expect(s.extras.lb).toBe(4)
    expect(s.batters[0].runs).toBe(0)
  })
})

describe('scorecard', () => {
  it('batting and bowling figures, maidens, partnerships, over lines', () => {
    // Over 1 (a1): maiden. Over 2 (a2): 4 6 1 W(h2 bowled) then h3: 2 0
    let f = balls(start(3), 0, 0, 0, 0, 0, 0)
    f = setCrease(f, { bowler: 'a2' })
    f = balls(f, 4, 6, 1, { wicket: { kind: 'bowled' } })
    f = setCrease(f, { striker: 'h3' })
    f = balls(f, 2, 0)
    const s = summarize(f, 0)
    expect(s.total).toBe(13)
    expect(s.overs).toBe('2.0')
    expect(s.runRate).toBeCloseTo(6.5)
    const [a1, a2] = s.bowlers
    expect(a1).toMatchObject({ id: 'a1', balls: 6, maidens: 1, runs: 0, wickets: 0, dots: 6 })
    expect(a2).toMatchObject({ id: 'a2', balls: 6, maidens: 0, runs: 13, wickets: 1, fours: 1, sixes: 1 })
    // h2 faced over 2 after the end-of-over swap: 4, 6, 1 — then h1 was bowled.
    expect(s.batters.find((b) => b.id === 'h2')).toMatchObject({ runs: 11, balls: 3, fours: 1, sixes: 1 })
    expect(s.batters.find((b) => b.id === 'h1')).toMatchObject({ runs: 0, balls: 7, out: { kind: 'bowled', bowler: 'a2' } })
    expect(s.partnerships.map((p) => [p.runs, p.balls, p.unbroken])).toEqual([
      [11, 10, false],
      [2, 2, true],
    ])
    expect(s.overLines.map((o) => [o.n, o.runs, o.wickets, o.total])).toEqual([
      [1, 0, 0, 0],
      [2, 13, 1, 13],
    ])
    expect(s.yetToBat).toEqual(['h4'])
    expect(s.shots).toMatchObject({ fours: 1, sixes: 1, ones: 1, twos: 1 })
  })
  it('ball tokens, numbers and commentary', () => {
    let f = balls(start(), { kind: 'wd' }, { bat: 4, shot: [-0.9, -0.14] }, { kind: 'nb', bat: 2 }, { byes: 1, byeType: 'lb' }, { wicket: { kind: 'caught', fielder: 'a3' } })
    const over = summarize(f, 0).overLines[0]
    expect(over.balls.map(ballToken)).toEqual(['wd', '4', 'nb+2', '1lb', 'W'])
    expect(ballNumbers(over)).toEqual(['0.1', '0.1', '0.2', '0.2', '0.3'])
    const name = (id: string) => id.toUpperCase()
    expect(ballText(over.balls[1], name)).toBe('A1 to H1, FOUR, to point')
    expect(ballText(over.balls[1], name, () => true)).toBe('A1 to H1, FOUR, to square leg')
    expect(ballText(over.balls[4], name)).toBe('A1 to H2, OUT! H2 c A3 b A1')
    f = undo(f)
    expect(summarize(f, 0).wickets).toBe(0)
  })
  it('names the shot regions for a right-hander', () => {
    expect(shotRegion([0, 1])).toBe('straight down the ground')
    expect(shotRegion([0, -1])).toBe('behind the wicket')
    expect(shotRegion([1, -0.14])).toBe('square leg')
    expect(shotRegion([-0.7, 0.6])).toBe('long off')
    expect(shotRegion([0.7, -0.9])).toBe('fine leg')
  })
})

describe('mandatory details', () => {
  const g = () => newScore({ teamId: 't', matchId: 'm', overs: 5, opponentId: 'o', home: { name: 'H', shortName: 'H', xi: ['h1', 'h2'] }, away: { name: 'A', shortName: 'A', xi: ['a1', 'a2'] }, toss: { wonBy: 'home', chose: 'bat' } })
  it('needs a named fielder for catches, stumpings and run outs', () => {
    let f = setCrease(g(), { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
    expect(() => addBall(f, { wicket: { kind: 'caught' } })).toThrow(/catch/)
    expect(() => addBall(f, { wicket: { kind: 'run_out', who: 'h1' } })).toThrow(/ran the batter out/)
    expect(() => addBall(f, { wicket: { kind: 'stumped' } })).toThrow(/keeper/)
    f = addBall(f, { wicket: { kind: 'caught', fielder: 'a2' } })
    expect(summarize(f, 0).wickets).toBe(1)
  })
  it('needs the toss and no more than eleven a side', () => {
    const base = { teamId: 't', matchId: 'm', overs: 5, opponentId: 'o', home: { name: 'H', shortName: 'H', xi: ['h1', 'h2'] }, away: { name: 'A', shortName: 'A', xi: ['a1', 'a2'] } }
    expect(() => newScore({ ...base, toss: {} as never })).toThrow(/toss/)
    const twelve = Array.from({ length: 12 }, (_, i) => `x${i}`)
    expect(() => newScore({ ...base, home: { ...base.home, xi: twelve }, toss: { wonBy: 'home', chose: 'bat' } })).toThrow(/11 at most/)
  })
})

describe('substitutes', () => {
  const eleven = Array.from({ length: 11 }, (_, i) => `p${i}`)
  const side = (xi: string[], subs?: string[]) => ({ name: 'X', shortName: 'X', xi, ...(subs ? { subs } : {}) })
  it('a side plays 11, plus substitutes who can bat and bowl', () => {
    expect(() => newScore({ matchId: 'm', teamId: 't', overs: 5, home: side([...eleven, 'extra']), away: side(A), toss: { wonBy: 'home', chose: 'bat' } })).toThrow(/11 at most/)
    let f = newScore({ matchId: 'm', teamId: 't', overs: 5, home: side(eleven, ['sub']), away: side(A, ['asub']), toss: { wonBy: 'home', chose: 'bat' } })
    f = setCrease(f, { striker: 'p0', nonStriker: 'sub', bowler: 'asub' })
    f = addBall(f, { bat: 2 })
    expect(summarize(f, 0).batters.map((b) => b.id)).toContain('sub')
    expect(() => newScore({ matchId: 'm', teamId: 't', overs: 5, home: side(eleven, ['a1']), away: side(A), toss: { wonBy: 'home', chose: 'bat' } })).toThrow(/both/)
  })
  it('all out still counts the 11, not the substitute', () => {
    let f = newScore({ matchId: 'm', teamId: 't', overs: 5, home: side(['h1', 'h2', 'h3'], ['hs']), away: side(A), toss: { wonBy: 'home', chose: 'bat' } })
    f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
    f = addBall(f, { wicket: { kind: 'bowled' } })
    f = setCrease(f, { striker: 'h3' })
    f = addBall(f, { wicket: { kind: 'bowled' } })
    expect(inn(f).closed).toBe('all_out')
  })
  it('a late player joins the XI, then becomes a substitute once there are 11', () => {
    let f = newScore({ matchId: 'm', teamId: 't', overs: 5, home: side(H), away: side(eleven), toss: { wonBy: 'home', chose: 'bat' } })
    f = addToXi(f, 'home', 'late')
    expect(f.home.xi).toContain('late')
    f = addToXi(f, 'away', 'extra')
    expect(f.away.subs).toEqual(['extra'])
    expect(f.away.xi).toHaveLength(11)
    expect(() => addToXi(f, 'home', 'extra')).toThrow(/already/)
  })
})
