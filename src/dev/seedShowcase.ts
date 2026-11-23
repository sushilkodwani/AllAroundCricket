// Dev only (never imported by the app): fills the demo repo "demo/showcase" with a believable club
// season, built with the app's own functions so every scorecard, chart and balance is real app output.
// Used to take the screenshots for the first-run intro. Run from the dev server's page:
//   const m = await import('/src/dev/seedShowcase.ts'); await m.seedShowcase()
// Test values (numbers, PIN) are in scripts/demo-fixtures.json under "showcase".
import { createBackend, openStore } from '../lib/connect'
import type { FakeBackend } from '../lib/fakeBackend'
import { setOwnPin, setupRepo } from '../lib/connect'
import {
  addContribution,
  addMatch,
  addNewPlayer,
  addOpponentPlayers,
  categoriesOf,
  completeMatch,
  createTeam,
  findOrCreatePlayer,
  getMatch,
  lookupPlayer,
  opponentsOf,
  saveGround,
  setAvailability,
  setSquad,
  settleShare,
  submitExpenses,
  updateProfile,
} from '../lib/domain'
import { suggestAwards } from '../lib/insights'
import { saveScore, startScoring } from '../lib/scoreDomain'
import { addBall, bowlerBlock, isFreeHit, outIds, previousOverBowler, setCrease, startSecondInnings, type BallInput } from '../lib/scoring'
import type { Store } from '../lib/store'
import { seedUsage } from './seedUsage'
import type { BowlStyle, ExpenseLine, Innings, PlayerRole, ScoreFile, SideKey, WicketKind } from '../types'

const REPO = { owner: 'demo', repo: 'showcase', token: 'demo-token' }

// ---------- the people ----------
interface P {
  name: string
  role: PlayerRole
  left?: boolean
  bowl?: BowlStyle
  bat: number // 1 (tail) … 10 (best)
  ball?: number // bowling skill 1 … 10
  jersey?: number
}
const CLUB: P[] = [
  { name: 'Rohan Deshpande', role: 'batter', bat: 8, bowl: 'rm', ball: 3, jersey: 7 },
  { name: 'Aarav Mehta', role: 'batter', left: true, bat: 9, bowl: 'lo', ball: 2, jersey: 18 },
  { name: 'Kunal Joshi', role: 'keeper', bat: 7, jersey: 1 },
  { name: 'Siddharth Rao', role: 'allrounder', bat: 7, bowl: 'rm', ball: 6, jersey: 24 },
  { name: 'Varun Iyer', role: 'batter', bat: 7, jersey: 10 },
  { name: 'Nikhil Kulkarni', role: 'allrounder', left: true, bat: 6, bowl: 'lo', ball: 7, jersey: 33 },
  { name: 'Harsh Vora', role: 'allrounder', bat: 5, bowl: 'ro', ball: 6, jersey: 21 },
  { name: 'Pranav Shetty', role: 'bowler', bat: 3, bowl: 'rf', ball: 8, jersey: 9 },
  { name: 'Aditya Menon', role: 'bowler', bat: 3, bowl: 'rl', ball: 8, jersey: 14 },
  { name: 'Yash Patil', role: 'bowler', left: true, bat: 2, bowl: 'lf', ball: 7, jersey: 11 },
  { name: 'Tejas Gokhale', role: 'bowler', bat: 2, bowl: 'rm', ball: 6, jersey: 45 },
  { name: 'Karan Malhotra', role: 'batter', bat: 6, jersey: 27 },
  { name: 'Omkar Sawant', role: 'allrounder', bat: 5, bowl: 'rm', ball: 5, jersey: 8 },
  { name: 'Manish Pillai', role: 'batter', left: true, bat: 5, jersey: 3 },
]
const SUPER = { name: 'Vikrant Desai' }

const RIVALS: { name: string; short: string; strength: number; players: P[] }[] = [
  {
    name: 'Andheri Avengers',
    short: 'AA',
    strength: 0.5,
    players: squad(['Rahul Bhalla', 'Sameer Khan', 'Ankit Verma', 'Deepak Nair', 'Gaurav Singh', 'Imran Shaikh', 'Jatin Arora', 'Mohit Saxena', 'Naveen Reddy', 'Pratik Jain', 'Sahil Kapoor']),
  },
  {
    name: 'Thane Titans',
    short: 'TT',
    strength: -0.5,
    players: squad(['Abhishek Pawar', 'Chetan More', 'Dhruv Bhosale', 'Ganesh Jadhav', 'Hemant Kadam', 'Mayur Shinde', 'Nilesh Chavan', 'Rajesh Gaikwad', 'Sachin Mane', 'Tushar Salunkhe', 'Vinod Thakur']),
  },
  {
    name: 'Powai Panthers',
    short: 'PP',
    strength: 0.3,
    players: squad(['Arjun Nambiar', 'Bharat Hegde', 'Chris D’Souza', 'Farhan Ansari', 'Jaydeep Kamath', 'Lalit Bhandari', 'Mihir Dalal', 'Neeraj Sinha', 'Parth Trivedi', 'Ritesh Goyal', 'Sunil Fernandes']),
  },
  {
    name: 'Borivali Blasters',
    short: 'BB',
    strength: -1,
    players: squad(['Akash Thakkar', 'Bhavesh Parmar', 'Darshan Panchal', 'Hitesh Solanki', 'Jignesh Rathod', 'Ketan Gohil', 'Mitesh Chauhan', 'Nirav Bhatt', 'Paresh Makwana', 'Rakesh Vaghela', 'Umesh Dave']),
  },
]

/** An eleven: openers and middle order bat, the last five bowl. */
function squad(names: string[]): P[] {
  const styles: BowlStyle[] = ['rf', 'rm', 'lo', 'rl', 'lf', 'ro']
  return names.map((name, i) => ({
    name,
    role: i === 2 ? 'keeper' : i < 5 ? 'batter' : i < 7 ? 'allrounder' : 'bowler',
    left: i % 4 === 1,
    bat: Math.max(2, 9 - i),
    bowl: i >= 5 ? styles[i - 5] : undefined,
    ball: i >= 5 ? 5 + ((i * 3) % 4) : undefined,
  }))
}

// ---------- seeded randomness, so the season is the same every run ----------
let seed = 20261120
function rnd(): number {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]
function weighted<T>(table: [T, number][]): T {
  const total = table.reduce((s, [, w]) => s + w, 0)
  let r = rnd() * total
  for (const [v, w] of table) if ((r -= w) <= 0) return v
  return table[table.length - 1][0]
}
const phoneFor = (i: number) => `9${String(810000000 + i * 7919).padStart(9, '0')}`

// ---------- one innings, ball by ball ----------
interface SideInfo {
  order: string[]
  bowlers: string[]
  keeper: string
  skill: Map<string, P>
  edge: number // team strength: + bats and bowls better
}

function shotFor(left: boolean, runs: number): [number, number] {
  // Angle from straight down the ground; leg side a little more often.
  const deg = weighted<number>([
    [0, 2],
    [30, 3],
    [65, 3],
    [100, 2],
    [140, 1],
    [-30, 2],
    [-65, 2],
    [-100, 2],
    [-140, 1],
  ]) + (rnd() - 0.5) * 24
  const a = ((left ? -deg : deg) * Math.PI) / 180
  // Boundaries reach the rope; 1s, 2s and 3s stop inside it (further for more runs).
  const r = runs === 6 ? 1 : runs === 4 ? 0.97 : 0.3 + runs * 0.12 + rnd() * 0.25
  return [Math.round(Math.sin(a) * r * 100) / 100, Math.round(Math.cos(a) * r * 100) / 100]
}

function nextBall(file: ScoreFile, inn: Innings, bat: SideInfo, bowl: SideInfo, over: number, overs: number): BallInput {
  const striker = bat.skill.get(inn.crease.striker!)!
  const bowler = bowl.skill.get(inn.crease.bowler!)!
  const phase = over < overs * 0.3 ? 'pp' : over >= overs * 0.75 ? 'death' : 'mid'
  const extra = weighted<'' | 'wd' | 'nb'>([
    ['', 95],
    ['wd', 4],
    ['nb', 1],
  ])
  if (extra === 'wd') return { kind: 'wd' }
  const skillGap = (striker.bat + bat.edge - (bowler.ball ?? 3) - bowl.edge) / 10
  const outChance = Math.max(0.02, 0.055 - skillGap * 0.03 + (phase === 'death' ? 0.02 : 0))
  if (extra === '' && !isFreeHit(inn) && rnd() < outChance) {
    const spinner = ['ro', 'rl', 'lo', 'lw'].includes(bowler.bowl ?? '')
    const kind = weighted<WicketKind>([
      ['caught', 46],
      ['bowled', 20],
      ['lbw', 12],
      ['caught_behind', 9],
      ['run_out', 6],
      ['stumped', spinner ? 6 : 0],
      ['caught_bowled', 3],
    ])
    const fielders = [...bowl.order.filter((id) => id !== inn.crease.bowler && id !== bowl.keeper)]
    const fielder = kind === 'caught' || kind === 'run_out' ? pick(fielders) : kind === 'caught_behind' || kind === 'stumped' ? bowl.keeper : undefined
    const at: [number, number] | undefined = kind === 'caught' || kind === 'run_out' ? [Math.round((rnd() * 1.6 - 0.8) * 100) / 100, Math.round((rnd() * 1.4 - 0.3) * 100) / 100] : undefined
    return { wicket: { kind, fielder, at, who: kind === 'run_out' && rnd() < 0.4 ? inn.crease.nonStriker : undefined }, bat: kind === 'run_out' ? 1 : 0 }
  }
  const attack = phase === 'pp' ? 1.2 : phase === 'death' ? 1.5 : 0.9
  const boost = 1 + skillGap * 0.8
  const runs = weighted<number>([
    [0, 36 / boost],
    [1, 33],
    [2, 9],
    [3, 1],
    [4, 11 * attack * boost],
    [6, 4.5 * attack * boost],
  ])
  const input: BallInput = { bat: runs }
  if (extra === 'nb') input.kind = 'nb'
  if (runs === 4 || runs === 6) input.shot = shotFor(!!striker.left, runs)
  // The scorer marks most singles, and skips a few.
  else if (runs >= 1 && file.allDirections && rnd() < 0.8) input.shot = shotFor(!!striker.left, runs)
  if (runs === 0 && rnd() < 0.05) return { byes: 1, byeType: rnd() < 0.5 ? 'lb' : 'b' }
  return input
}

/**
 * Gives every event a believable time, as if scored live: 25–55 s a ball, a minute or
 * two between overs, longer after a wicket, now and then a stoppage, and a 15-minute
 * innings break. Without this every ball carries the moment the demo was built.
 */
function stampTimes(file: ScoreFile, date: string): ScoreFile {
  let t = Date.parse(`${date}T07:45:00+05:30`)
  const innings = file.innings.map((inn, n) => {
    if (n > 0) t += 15 * 60_000
    let legal = 0
    let lastWicket = false
    const events = inn.events.map((e) => {
      t += 25_000 + rnd() * 30_000
      if (legal > 0 && legal % 6 === 0 && e.t === 'ball') t += 50_000 + rnd() * 50_000
      if (lastWicket) t += 80_000 + rnd() * 70_000
      if (rnd() < 0.01) t += 3 * 60_000 // lost ball, a word with the umpire
      if (e.t === 'ball') {
        lastWicket = !!e.wicket
        if (e.kind === 'legal') legal++
      }
      return { ...e, at: new Date(Math.round(t)).toISOString() }
    })
    return { ...inn, events }
  })
  return { ...file, innings, startedAt: innings[0]?.events[0]?.at ?? file.startedAt }
}

/** Plays the current innings to its end (or `stopAfterOvers`). */
function playInnings(file: ScoreFile, bat: SideInfo, bowl: SideInfo, stopAfterOvers?: number): ScoreFile {
  const idx = file.innings.length - 1
  const overs = file.overs
  let plan = 0
  for (let guard = 0; guard < 1000; guard++) {
    const inn = file.innings[idx]
    if (inn.closed) break
    const legal = inn.events.filter((e) => e.t === 'ball' && e.kind === 'legal').length
    const over = Math.floor(legal / 6)
    if (stopAfterOvers !== undefined && legal >= stopAfterOvers * 6) break
    const out = outIds(inn)
    const used = new Set(inn.events.flatMap((e) => (e.t === 'ball' ? [e.striker, e.nonStriker] : [])))
    const fresh = () => {
      const c = file.innings[idx].crease
      return bat.order.find((id) => !used.has(id) && !out.has(id) && id !== c.striker && id !== c.nonStriker)
    }
    if (!inn.crease.striker) file = setCrease(file, { striker: fresh() })
    if (!file.innings[idx].crease.nonStriker) file = setCrease(file, { nonStriker: fresh() })
    if (!file.innings[idx].crease.bowler) {
      const cur = file.innings[idx]
      const prev = previousOverBowler(cur)
      // Best bowlers first, spread over the innings, never two overs in a row.
      const order = [...bowl.bowlers.slice(plan % bowl.bowlers.length), ...bowl.bowlers.slice(0, plan % bowl.bowlers.length)]
      const who = order.find((id) => id !== prev && !bowlerBlock(file, cur, id)) ?? bowl.bowlers.find((id) => id !== prev)!
      plan++
      file = setCrease(file, { bowler: who })
    }
    const ball = nextBall(file, file.innings[idx], bat, bowl, over, overs)
    try {
      file = addBall(file, ball)
    } catch {
      file = addBall(file, { bat: 0 })
    }
  }
  return file
}

// ---------- the season ----------
export async function seedShowcase(opts: { as?: 'player' | 'super' } = {}): Promise<{ playerName: string; matches: number; results: string[] }> {
  // Start clean: the fake repo and this browser's cached copy of it.
  localStorage.removeItem('aac.demo.showcase')
  ;(createBackend(REPO) as FakeBackend).files.clear()
  await (await openStore(REPO)).clear()
  const store: Store = await openStore(REPO)
  const pin = '480137'

  const owner = await setupRepo(store, { name: SUPER.name, phone: phoneFor(0), pin })
  store.actor = { role: 'super', personId: owner.personId }

  for (const g of [
    { name: 'Shivaji Park Ground 3', pitch: 'turf' as const, fee: 4400, notes: 'Bring white balls. Parking at Gate 5.' },
    { name: 'Oval Maidan North', pitch: 'matting' as const, fee: 3600 },
    { name: 'Cross Maidan', pitch: 'turf' as const, fee: 4000 },
  ]) {
    saveGround(store, g)
  }

  const team = createTeam(store, { name: 'Shivaji Park Strikers', shortName: 'SPS', color: '#1e3a8a', homeGround: 'Shivaji Park Ground 3' })
  const ids: string[] = []
  const skill = new Map<string, P>()
  for (const [i, p] of CLUB.entries()) {
    const phone = phoneFor(i + 1)
    const look = await lookupPlayer(store, team.id, phone)
    if (look.kind !== 'new') throw new Error('Number already used: ' + p.name)
    const person = addNewPlayer(store, team.id, p.name, phone, look.phoneHash)
    updateProfile(store, person.id, { role: p.role, batsLeft: !!p.left, bowlStyle: p.bowl, jersey: p.jersey })
    ids.push(person.id)
    skill.set(person.id, p)
  }
  const byName = (n: string) => ids[CLUB.findIndex((p) => p.name === n)]

  // Opponents and their elevens.
  const rivals: { name: string; edge: number; ids: string[]; skill: Map<string, P> }[] = []
  let n = 100
  for (const r of RIVALS) {
    const theirIds: string[] = []
    const theirSkill = new Map<string, P>()
    for (const p of r.players) {
      const { person } = await findOrCreatePlayer(store, p.name, phoneFor(n++))
      updateProfile(store, person.id, { role: p.role, batsLeft: !!p.left, bowlStyle: p.bowl })
      theirIds.push(person.id)
      theirSkill.set(person.id, p)
    }
    rivals.push({ name: r.name, edge: r.strength, ids: theirIds, skill: theirSkill })
  }

  // Money in: everyone tops up their fund at the start of the season, some again in October.
  // The four who end up owing money put in less and skip the October top-up.
  const shortOf = new Set(['Karan Malhotra', 'Manish Pillai', 'Omkar Sawant', 'Harsh Vora'].map(byName))
  for (const [i, id] of ids.entries()) {
    const amount = shortOf.has(id) ? 2000 : i % 3 === 0 ? 4000 : 3000
    addContribution(store, team.id, { personId: id, amount, date: '2026-08-01', method: i % 2 ? 'upi' : 'cash', note: 'Season top-up' })
  }
  for (const [i, id] of ids.entries()) {
    if (!shortOf.has(id)) addContribution(store, team.id, { personId: id, amount: i % 2 ? 2000 : 2500, date: '2026-10-02', method: 'upi', note: 'October top-up' })
  }

  const fixtures = [
    { date: '2026-08-09', rival: 0, venue: 'Shivaji Park Ground 3' },
    { date: '2026-08-23', rival: 1, venue: 'Oval Maidan North' },
    { date: '2026-09-06', rival: 2, venue: 'Cross Maidan' },
    { date: '2026-09-20', rival: 3, venue: 'Shivaji Park Ground 3' },
    { date: '2026-10-04', rival: 0, venue: 'Cross Maidan' },
    { date: '2026-10-18', rival: 1, venue: 'Shivaji Park Ground 3' },
    { date: '2026-11-01', rival: 2, venue: 'Oval Maidan North' },
    { date: '2026-11-15', rival: 3, venue: 'Shivaji Park Ground 3' },
  ]
  const results: string[] = []
  const battingOrder = ['Rohan Deshpande', 'Aarav Mehta', 'Kunal Joshi', 'Varun Iyer', 'Siddharth Rao', 'Karan Malhotra', 'Nikhil Kulkarni', 'Manish Pillai', 'Harsh Vora', 'Omkar Sawant', 'Pranav Shetty', 'Aditya Menon', 'Yash Patil', 'Tejas Gokhale']
  const ourBowlers = ['Pranav Shetty', 'Yash Patil', 'Aditya Menon', 'Nikhil Kulkarni', 'Siddharth Rao', 'Harsh Vora', 'Tejas Gokhale', 'Omkar Sawant', 'Rohan Deshpande']
  const cats = categoriesOf(store, team.id)

  async function playMatch(fixture: { date: string; rival: number; venue: string }, k: number, live: boolean) {
    const rival = rivals[fixture.rival]
    const match = addMatch(store, team.id, { date: fixture.date, time: '07:30', opponent: rival.name, venue: fixture.venue, matchType: 'league', overs: 20 })
    // Three players rest each week, never the captain, keeper or Aarav.
    const fixed = ['Rohan Deshpande', 'Aarav Mehta', 'Kunal Joshi']
    const others = battingOrder.filter((x) => !fixed.includes(x))
    const resting = new Set([others[k % others.length], others[(k + 4) % others.length], others[(k + 7) % others.length]])
    const xiNames = battingOrder.filter((x) => !resting.has(x)).slice(0, 11)
    const xi = xiNames.map(byName)
    setSquad(store, team.id, match.id, xi)
    const opp = opponentsOf(store).find((o) => o.name === rival.name)!
    addOpponentPlayers(store, opp.id, rival.ids)
    const tossWon: SideKey = rnd() < 0.5 ? 'home' : 'away'
    const chose = rnd() < 0.6 ? 'bat' : 'bowl'
    let file = startScoring(store, {
      teamId: team.id,
      matchId: match.id,
      overs: 20,
      opponentId: opp.id,
      home: { name: team.name, shortName: team.shortName, xi, captainId: byName('Rohan Deshpande'), keeperId: byName('Kunal Joshi') },
      away: { name: rival.name, shortName: RIVALS[fixture.rival].short, xi: rival.ids, captainId: rival.ids[0], keeperId: rival.ids[2] },
      toss: { wonBy: tossWon, chose },
      allDirections: true,
    })
    const us: SideInfo = {
      order: xi,
      bowlers: ourBowlers.filter((b) => xiNames.includes(b)).map(byName).slice(0, 6),
      keeper: byName('Kunal Joshi'),
      skill,
      edge: 1.6,
    }
    const them: SideInfo = { order: rival.ids, bowlers: rival.ids.slice(5, 11).reverse(), keeper: rival.ids[2], skill: rival.skill, edge: live ? 2.2 : rival.edge }
    // Today's game is a tight chase, so the live screen has something to show.
    if (live) us.edge = 0.4
    const first = file.innings[0].batting === 'home' ? [us, them] : [them, us]
    file = playInnings(file, first[0], first[1])
    file = startSecondInnings(file)
    file = playInnings(file, first[1], first[0], live ? 13 : undefined)
    if (file.status === 'finished') file = { ...file, awards: suggestAwards(file) }
    // The first match was typed in afterwards, so it has no minutes; the rest were scored live.
    if (k > 0) file = stampTimes(file, fixture.date)
    saveScore(store, file, live ? 'Live' : 'Result')
    if (live) {
      results.push(`LIVE ${rival.name}`)
      return
    }
    results.push(`${file.result?.text ?? '?'} | ${(await import('../lib/scorecard')).scoreLine(file, 0)} v ${(await import('../lib/scorecard')).scoreLine(file, 1)}`)

    // Expenses: ground fee, balls, breakfast (two skip it).
    const ground = { 'Shivaji Park Ground 3': 4400, 'Oval Maidan North': 3600, 'Cross Maidan': 4000 }[fixture.venue] ?? 4000
    const lines: ExpenseLine[] = [
      { categoryId: cats[0].id, categoryName: cats[0].name, mode: cats[0].mode, total: ground, excludedPersonIds: [] },
      { categoryId: cats[1].id, categoryName: cats[1].name, mode: cats[1].mode, total: 900, excludedPersonIds: [] },
      { categoryId: cats[2].id, categoryName: cats[2].name, mode: cats[2].mode, total: 990 + (k % 3) * 110, excludedPersonIds: [xi[9], xi[10]] },
    ]
    submitExpenses(store, team.id, match.id, { lines, payerIds: xi })
    // Older matches are fully paid; the latest keeps a few dues open.
    const m = getMatch(store, team.id, match.id)!
    for (const sh of m.expense!.shares.filter((s) => !s.settled)) {
      const owes = k === 7 && ['Karan Malhotra', 'Manish Pillai', 'Omkar Sawant', 'Harsh Vora'].some((x) => byName(x) === sh.personId)
      if (!owes) settleShare(store, team.id, match.id, sh.personId, { method: 'upi', date: fixture.date })
    }
    if (k < 7) completeMatch(store, team.id, match.id)
  }

  for (const [k, f] of fixtures.entries()) await playMatch(f, k, false)
  // Today: a live chase.
  await playMatch({ date: '2026-11-20', rival: 0, venue: 'Shivaji Park Ground 3' }, 8, true)

  // Next weekend: squad not picked yet, availability coming in.
  const next = addMatch(store, team.id, { date: '2026-11-29', time: '07:00', opponent: 'Thane Titans', venue: 'Cross Maidan', matchType: 'league', overs: 20 })
  for (const [i, id] of ids.entries()) {
    if (i === 1) continue // the logged-in player answers it themselves in the screenshot
    const st = i % 5 === 4 ? 'out' : i % 7 === 3 ? 'maybe' : 'in'
    setAvailability(store, team.id, next.id, id, st)
  }

  if (!(await store.flush())) throw new Error('Could not save the showcase data')

  // Two months of app usage, for the super admin's Usage screen.
  await seedUsage(store, [{ id: owner.personId, name: SUPER.name, super: true }, ...CLUB.map((p, i) => ({ id: ids[i], name: p.name }))])

  // The screenshots are taken as a player: Aarav Mehta sets a PIN and logs this browser in.
  // With { as: 'super' } this browser is logged in as the super admin instead.
  const aarav = byName('Aarav Mehta')
  store.actor = { role: 'viewer', personId: aarav }
  const device = await setOwnPin(store, aarav, pin)
  await store.flush()
  const login = opts.as === 'super' ? { personId: owner.personId, sessionEpoch: owner.sessionEpoch, deviceId: owner.deviceId, deviceSecret: owner.deviceSecret } : { personId: aarav, ...device }
  localStorage.setItem('aac.session', JSON.stringify({ ...REPO, ...login }))
  localStorage.setItem('aac.repo', JSON.stringify(REPO))
  return { playerName: 'Aarav Mehta', matches: fixtures.length + 2, results }
}
