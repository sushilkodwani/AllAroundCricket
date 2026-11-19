import { describe, expect, it } from 'vitest'
import type { ScoreFile } from '../types'
import { addBall, bowlerBlock, bowlingRule, bowlingRuleText, newScore, oversBowledBy, setCrease } from './scoring'

describe('overs per bowler', () => {
  it('shares the overs among at least five bowlers, as evenly as possible', () => {
    const table: [number, number, number, number][] = [
      [5, 1, 0, 1],
      [10, 2, 0, 2],
      [12, 2, 2, 3],
      [15, 3, 0, 3],
      [16, 3, 1, 4],
      [17, 3, 2, 4],
      [18, 3, 3, 4],
      [19, 3, 4, 4],
      [20, 4, 0, 4],
    ]
    for (const [overs, base, extra, max] of table) {
      expect(bowlingRule(overs), `${overs} overs`).toEqual({ base, extra, max })
      // The rule really can be met: the most overs the 5 bowlers can bowl adds up to the match.
      expect(5 * base + extra).toBe(overs)
    }
  })
  it('works for short matches and small sides', () => {
    expect(bowlingRule(3)).toEqual({ base: 0, extra: 3, max: 1 })
    expect(bowlingRule(10, 4)).toEqual({ base: 2, extra: 2, max: 3 })
  })
  it('says it in words', () => {
    expect(bowlingRuleText(bowlingRule(15))).toBe('At most 3 overs each.')
    expect(bowlingRuleText(bowlingRule(17))).toBe('At most 4 overs each — only 2 bowlers may bowl 4, the rest 3.')
    expect(bowlingRuleText(bowlingRule(16))).toBe('At most 4 overs each — only 1 bowler may bowl 4, the rest 3.')
  })
})

const H = ['h1', 'h2', 'h3', 'h4']
const A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']

function start(overs: number): ScoreFile {
  const f = newScore({ matchId: 'm', teamId: 't', overs, home: { name: 'Home', shortName: 'HOM', xi: H }, away: { name: 'Away', shortName: 'AWY', xi: A }, toss: { wonBy: 'home', chose: 'bat' } })
  return setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
}
/** One maiden over by the current bowler, then the next bowler is set (or not, if given none). */
const over = (f: ScoreFile, next?: string): ScoreFile => {
  let g = f
  for (let i = 0; i < 6; i++) g = addBall(g, { bat: 0 })
  return next ? setCrease(g, { bowler: next }) : g
}
const inn = (f: ScoreFile) => f.innings[f.innings.length - 1]

describe('the rule while scoring', () => {
  it('stops a bowler going past the most overs', () => {
    // 17 overs: max 4. a1 and a2 take turns for eight overs.
    let f = start(17)
    for (const b of ['a2', 'a1', 'a2', 'a1', 'a2', 'a1', 'a2']) f = over(f, b)
    f = over(f)
    expect(oversBowledBy(inn(f)).get('a1')).toBe(4)
    expect(() => setCrease(f, { bowler: 'a1' })).toThrow(/two overs in a row|most overs/)
    f = setCrease(f, { bowler: 'a3' })
    expect(inn(f).crease.bowler).toBe('a3')
  })

  it('lets only as many bowlers reach the top as the rule allows', () => {
    let f = start(17) // max 4 for two bowlers, the rest 3
    for (const b of ['a2', 'a1', 'a2', 'a1', 'a2', 'a1', 'a2']) f = over(f, b) // a1 and a2 have 4 each after the next over
    f = over(f, 'a3') // overs 1-8 done, a3 starts over 9
    for (const b of ['a4', 'a3', 'a4', 'a3', 'a4']) f = over(f, b) // overs 9-14: a3 and a4 three each
    f = over(f, 'a5') // over 15
    f = over(f) // over 15 finished; the next is over 16
    // a3 has bowled 3. A 4th would be a third bowler on 4 overs: refused. A fresh bowler is fine.
    expect(bowlerBlock(f, inn(f), 'a3')).toMatch(/only 2 bowlers may bowl 4 overs/)
    expect(bowlerBlock(f, inn(f), 'a6')).toBeNull()
    expect(() => setCrease(f, { bowler: 'a3' })).toThrow(/only 2 bowlers/)
    expect(inn(setCrease(f, { bowler: 'a6' })).crease.bowler).toBe('a6')
  })

  it('never leaves the scorer with nobody to pick', () => {
    // A two-player bowling side with 10 overs: the rule would block both after 5 each, but never both at once.
    let f = newScore({ matchId: 'm', teamId: 't', overs: 10, home: { name: 'H', shortName: 'H', xi: H }, away: { name: 'A', shortName: 'A', xi: ['a1', 'a2'] }, toss: { wonBy: 'home', chose: 'bat' } })
    f = setCrease(f, { striker: 'h1', nonStriker: 'h2', bowler: 'a1' })
    for (let i = 0; i < 9; i++) f = over(f, i % 2 === 0 ? 'a2' : 'a1')
    expect(inn(f).closed).toBeUndefined()
  })
})

import { memoryKV } from './cache'
import { fakeBackend } from './fakeBackend'
import { Store } from './store'
import { peopleOf, setBatsLeft, setBowlStyle, updateProfile } from './domain'
import { batsText } from '../components/Profile'
import { P } from './paths'

describe('batting hand and bowling style on the profile', () => {
  function withPlayer() {
    const store = new Store(fakeBackend(), memoryKV(), 5)
    store.actor = { role: 'setup', personId: 'x' }
    store.write(P.people, { schemaVersion: 1, people: [{ id: 'p', name: 'Pat', access: 'view', isGuest: false, teamIds: [], createdAt: '', updatedAt: '' }] }, 'seed')
    return store
  }
  it('tells a right-hander from "not set"', () => {
    const s = withPlayer()
    expect(batsText(peopleOf(s)[0])).toBe('Batting hand not set')
    setBatsLeft(s, 'p', false)
    expect(peopleOf(s)[0].batsLeft).toBe(false)
    expect(batsText(peopleOf(s)[0])).toBe('Right-hand bat')
    setBatsLeft(s, 'p', true)
    expect(batsText(peopleOf(s)[0])).toBe('Left-hand bat')
  })
  it('saves a bowling style without touching the rest', () => {
    const s = withPlayer()
    setBowlStyle(s, 'p', 'lm')
    expect(peopleOf(s)[0]).toMatchObject({ name: 'Pat', bowlStyle: 'lm' })
  })
  it('the profile form can still leave the hand unset, or set it either way', () => {
    const s = withPlayer()
    updateProfile(s, 'p', { batsLeft: false })
    expect(peopleOf(s)[0].batsLeft).toBe(false)
    updateProfile(s, 'p', { batsLeft: undefined })
    expect('batsLeft' in peopleOf(s)[0]).toBe(false)
  })
})
