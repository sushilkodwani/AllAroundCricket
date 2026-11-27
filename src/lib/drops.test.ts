import { describe, expect, it } from 'vitest'
import type { ScoreFile } from '../types'
import { planPrompt, reviewPrompt } from './aiPrompts'
import { ballText } from './scorecard'
import { catchesIn, dropsIn, dropSummary, impactText, playerDrops } from './drops'
import { addBall, editBall, endInnings, newScore, setCrease, startSecondInnings, type BallInput } from './scoring'

const H = ['h1', 'h2', 'h3', 'h4']
const A = ['a1', 'a2', 'a3', 'a4']
const DROP = { by: 'a2', tough: true, at: [0.3, -0.5] as [number, number] }

function base(): ScoreFile {
  const f = newScore({ matchId: 'm', teamId: 't', overs: 2, home: { name: 'Home', shortName: 'HOM', xi: H }, away: { name: 'Away', shortName: 'AWY', xi: A }, toss: { wonBy: 'home', chose: 'bat' } })
  return setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
}
const play = (f: ScoreFile, ...inputs: BallInput[]) => inputs.reduce((acc, x) => addBall(acc, x), f)

/** Home bat: h1 is dropped on his first ball, makes 10, is bowled; h3 is caught by a3. Away then chase and fall 7 short. */
function match(winner: 'home' | 'away' = 'home'): ScoreFile {
  let f = play(base(), { bat: 0, drop: DROP }, { bat: 4 }, { bat: 6 }, { wicket: { kind: 'bowled' } })
  f = setCrease(f, { striker: 'h3' })
  f = play(f, { wicket: { kind: 'caught', fielder: 'a3' } })
  f = endInnings(f)
  f = startSecondInnings(f)
  f = setCrease(f, { striker: 'a1', nonStriker: 'a2', bowler: 'h3' })
  f = play(f, { bat: 1 }, { bat: 2 })
  f = endInnings(f)
  return { ...f, status: 'finished', result: { winner, text: 'result' } }
}

describe('marking a dropped catch', () => {
  it('stores who dropped it, where and whether it was tough', () => {
    const f = play(base(), { bat: 1, drop: DROP })
    const b = f.innings[0].events[0]
    expect(b.t === 'ball' && b.drop).toEqual(DROP)
  })
  it('only a fielder of the fielding side, never off a wide or with a catch out', () => {
    expect(() => play(base(), { bat: 0, drop: { by: 'h2' } })).toThrow(/fielding side/)
    expect(() => play(base(), { kind: 'wd', drop: { by: 'a2' } })).toThrow(/wide/)
    expect(() => play(base(), { wicket: { kind: 'caught', fielder: 'a2' }, drop: { by: 'a3' } })).toThrow(/both/)
    // It can happen off a no-ball.
    expect(() => play(base(), { kind: 'nb', bat: 2, drop: { by: 'a2' } })).not.toThrow()
  })
  it('can be added to, changed on and taken off an earlier ball', () => {
    let f = play(base(), { bat: 1 })
    const id = f.innings[0].events[0].id
    f = editBall(f, 0, id, { bat: 1, byes: 0, drop: { by: 'a3' } })
    expect((f.innings[0].events[0] as { drop?: unknown }).drop).toEqual({ by: 'a3' })
    f = editBall(f, 0, id, { bat: 1, byes: 0, drop: null })
    expect((f.innings[0].events[0] as { drop?: unknown }).drop).toBeUndefined()
  })
})

describe('what a drop cost', () => {
  it('counts the runs the batter made after the life, and calls it decisive when that covers the margin', () => {
    const [d] = dropsIn([match()])
    expect(d).toMatchObject({ by: 'a2', batter: 'h1', bowler: 'a1', fieldingSide: 'away', tough: true, runsAfter: 10, out: true, impact: 'decisive', margin: 7 })
    expect(impactText(d)).toMatch(/lost by 7/)
  })
  it('costs nothing in the match result when the dropper’s side won', () => {
    const [d] = dropsIn([match('away')])
    expect(d.runsAfter).toBe(10)
    expect(d.impact).toBe('none')
  })
})

describe('catching totals', () => {
  const files = [match()]
  it('counts catches held', () => {
    expect(catchesIn(files)).toEqual([{ matchId: 'm', by: 'a3', fieldingSide: 'away' }])
  })
  it('a team’s chances, catch rate, cost and fielders', () => {
    const s = dropSummary(files, 'away')
    expect(s).toMatchObject({ drops: 1, tough: 1, taken: 1, chances: 2, rate: 50, runsCost: 10, decisive: 1 })
    expect(s.byFielder.map((r) => [r.id, r.drops, r.taken, r.rate])).toEqual([
      ['a2', 1, 0, 0],
      ['a3', 0, 1, 100],
    ])
    expect(s.marks).toEqual([[0.3, -0.5]])
    expect(dropSummary(files, 'home').drops).toBe(0)
  })
  it('a player as fielder, batter and bowler', () => {
    expect(playerDrops(files, 'a2').fielding).toMatchObject({ drops: 1, taken: 0, rate: 0, runsCost: 10 })
    expect(playerDrops(files, 'h1').lives).toEqual({ count: 1, runsAfter: 10, stillOut: 1 })
    expect(playerDrops(files, 'a1').luck).toEqual({ count: 1, runsAfter: 10 })
    expect(playerDrops(files, 'a3').fielding).toMatchObject({ drops: 0, taken: 1, rate: 100 })
  })
})

describe('where drops show up', () => {
  const people = [...H, ...A].map((id) => ({ id, name: id.toUpperCase(), access: 'view', isGuest: false, teamIds: [], createdAt: '', updatedAt: '' }))
  it('the commentary says it', () => {
    const f = match()
    const ball = f.innings[0].events[0]
    expect(ball.t === 'ball' && ballText(ball, (id) => id.toUpperCase())).toMatch(/CATCH DROPPED! A2 puts down a hard chance at/)
  })
  it('the review prompt names the drop and what it cost; the team block counts catching', () => {
    const ctx = { teamName: 'Home', files: [match()], matches: [], people: people as never }
    const p = reviewPrompt(ctx, { id: 'm', teamId: 't', date: '2026-05-10', opponent: 'Away', matchType: 'friendly', squad: [], lifecycle: 'completed' } as never, match())
    expect(p.prompt).toContain('Dropped catches in this match:')
    expect(p.prompt).toContain('A2 (Away) dropped H1 (a hard chance)')
    expect(p.prompt).toContain('Could have decided it')
    expect(planPrompt({ ...ctx, files: [match()] }, { id: 'm', teamId: 't', date: '2026-05-10', opponent: 'Away', matchType: 'friendly', squad: ['h1'], lifecycle: 'scheduled' } as never).prompt).toContain('Catching (only drops the scorers marked)')
  })
})
