// The fixed questions the AI reports ask, and the facts that go with them. The app
// works out every number itself (from the score files) and sends a short written
// summary; the model is only asked to read it and advise, never to calculate.
// Nothing personal is sent: no phone numbers, PINs or money, just cricket figures.
import type { AiKind, Match, Person, ScoreFile } from '../types'
import { BOWL_LABELS, ROLE_LABELS, WICKET_LABELS } from '../types'
import { phaseStats } from './analysis'
import { batAverage, batStrikeRate, bestBowling, bowlEconomy, bowlOvers, careerStats, formOf, highScore, type Career } from './career'
import { fmtDate } from './dates'
import { summarize } from './scorecard'
import { inningsTotal, squadOf } from './scoring'
import { byGround, byOpponent, firstVsChase, phaseProfile } from './season'

export interface AiCtx {
  teamName: string
  /** Every scored match of the team. Our side is always `home`. */
  files: ScoreFile[]
  matches: Match[]
  people: Person[]
}

export interface Prompt {
  system: string
  prompt: string
}

export const SYSTEM = [
  'You are an experienced cricket coach and analyst helping the captain and admin of a club cricket team.',
  'Use only the facts in the message. Never invent scores, players or statistics. Do not do your own arithmetic: quote only numbers that appear in the message (balls to spare, margins, averages are given where they matter). When a player or situation has very few matches or balls behind it, say the sample is small instead of drawing a strong conclusion.',
  'Be specific, practical and thorough, and use the players’ names. A full answer is roughly 900 to 1,400 words; never pad, but do not stop short.',
  'Format with short headings that start with "## ". Under each, write bullet points that start with "- ", and begin each bullet with a bold lead-in such as a player’s name or a short label, then a dash and the point, for example "- **Santosh Khude** — opens: 111 strike rate and 52* last time". Use a numbered list ("1. ", "2. ") for any ordered list such as a batting order, and write an over-by-over plan as bullets like "- **Overs 1–2** — Priyanshu". Never use tables. No introduction and no closing remarks.',
].join(' ')

const nameOf = (ctx: AiCtx, id: string) => ctx.people.find((p) => p.id === id)?.name ?? 'Unknown'
const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '–' : String(v))
const finished = (f: ScoreFile) => f.status === 'finished' && f.innings.length === 2
const wonByUs = (f: ScoreFile) => f.result?.winner === 'home'

/** One line about a player: role, hand, and what the matches so far show. */
export function playerLine(ctx: AiCtx, id: string, careers: Map<string, Career>): string {
  const p = ctx.people.find((x) => x.id === id)
  const c = careers.get(id)
  const traits = [p?.role ? ROLE_LABELS[p.role] : null, p?.batsLeft === undefined ? null : p.batsLeft ? 'left-hand bat' : 'right-hand bat', p?.bowlStyle ? `bowls ${BOWL_LABELS[p.bowlStyle]}` : null].filter(Boolean).join(', ')
  const head = `${nameOf(ctx, id)}${traits ? ` (${traits})` : ''}`
  if (!c) return `${head}: no scored matches yet`
  const form = formOf(c, ctx.matches)
  const bits = [`${c.matches} matches`]
  if (c.bat.innings > 0) bits.push(`batting ${c.bat.runs} runs in ${c.bat.innings} inns, avg ${dash(batAverage(c))}, SR ${dash(batStrikeRate(c))}, HS ${highScore(c)}, ${c.bat.fours}x4 ${c.bat.sixes}x6, ${c.bat.ducks} ducks`)
  if (c.bowl.balls > 0) bits.push(`bowling ${c.bowl.wickets} wkts in ${bowlOvers(c)} overs, econ ${dash(bowlEconomy(c))}, best ${bestBowling(c)}`)
  if (c.field.catches + c.field.stumpings + c.field.runOuts > 0) bits.push(`fielding ${c.field.catches} catches, ${c.field.stumpings} stumpings, ${c.field.runOuts} run-outs`)
  if (form.bat.length) bits.push(`last scores ${form.bat.join(', ')}`)
  if (form.bowl.length) bits.push(`last spells ${form.bowl.join(', ')}`)
  const ph = phaseProfile(ctx.files, id)
  const phases = ph
    .filter((r) => r.bat.balls >= 12 || r.bowl.balls >= 12)
    .map((r) => {
      const parts: string[] = []
      if (r.bat.balls >= 12) parts.push(`bat SR ${Math.round((r.bat.runs * 100) / r.bat.balls)} (${r.bat.balls} balls)`)
      if (r.bowl.balls >= 12) parts.push(`econ ${((r.bowl.runs * 6) / r.bowl.balls).toFixed(1)} (${r.bowl.balls} balls)`)
      return `${r.label} ${parts.join(', ')}`
    })
  if (phases.length) bits.push(`by phase: ${phases.join('; ')}`)
  return `${head}: ${bits.join('; ')}`
}

/** How the team has done overall, batting first and chasing, and after winning or losing the toss. */
function teamBlock(ctx: AiCtx): string {
  const done = ctx.files.filter(finished)
  if (done.length === 0) return 'No finished scored matches yet.'
  const won = done.filter(wonByUs).length
  const v = firstVsChase(done, 'home')
  const recent = [...done]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 5)
    .map((f) => (wonByUs(f) ? 'W' : f.result?.winner ? 'L' : 'T'))
    .join('')
  const line = (label: string, s: { played: number; won: number; avgRuns?: number | null }) => `${label}: won ${s.won} of ${s.played}${s.avgRuns ? `, average score ${Math.round(s.avgRuns)}` : ''}`
  return [
    `Played ${done.length}, won ${won}, lost ${done.length - won}. Recent form (newest first): ${recent}.`,
    line('Batting first', v.battingFirst),
    line('Chasing', v.chasing),
    `After winning the toss we won ${v.tossWon.won} of ${v.tossWon.played}; after losing it ${v.tossLost.won} of ${v.tossLost.played}.`,
  ].join('\n')
}

/** Our record against one opponent, from earlier meetings. */
function opponentBlock(ctx: AiCtx, match: Match): string {
  const rec = byOpponent(ctx.files, 'home').find((r) => r.name.toLowerCase() === match.opponent.toLowerCase())
  if (!rec) return `We have not played ${match.opponent} in a scored match before.`
  const meetings = ctx.files
    .filter((f) => finished(f) && f.away.name.toLowerCase() === match.opponent.toLowerCase())
    .map((f) => `${f.result?.text ?? 'result unknown'} (we made ${inningsTotal(f, f.innings[0].batting === 'home' ? 0 : 1)}, they made ${inningsTotal(f, f.innings[0].batting === 'home' ? 1 : 0)})`)
  const theirs = ctx.files.filter((f) => f.away.name.toLowerCase() === match.opponent.toLowerCase())
  const careers = careerStats(theirs)
  const ids = new Set(theirs.flatMap((f) => squadOf(f.away)))
  const list = [...careers.values()].filter((c) => ids.has(c.id))
  const bat = [...list].sort((a, b) => b.bat.runs - a.bat.runs).slice(0, 3).filter((c) => c.bat.runs > 0)
  const bowl = [...list].sort((a, b) => b.bowl.wickets - a.bowl.wickets).slice(0, 3).filter((c) => c.bowl.wickets > 0)
  return [
    `Against ${match.opponent}: played ${rec.played}, won ${rec.won}, lost ${rec.lost}. ${meetings.join('; ')}.`,
    bat.length ? `Their best batters against us: ${bat.map((c) => `${nameOf(ctx, c.id)} ${c.bat.runs} runs (SR ${dash(batStrikeRate(c))})`).join(', ')}.` : '',
    bowl.length ? `Their best bowlers against us: ${bowl.map((c) => `${nameOf(ctx, c.id)} ${c.bowl.wickets} wkts (econ ${dash(bowlEconomy(c))})`).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function groundBlock(ctx: AiCtx, match: Match): string {
  if (!match.venue) return 'No venue set.'
  const g = byGround(ctx.files, ctx.matches).find((x) => x.venue.toLowerCase() === match.venue!.toLowerCase())
  if (!g) return `${match.venue}: we have not played a scored match here yet.`
  return `${match.venue}: ${g.played} matches here, average first-innings score ${dash(g.avgFirst === null ? null : Math.round(g.avgFirst))}, side batting first won ${dash(g.batFirstWinPct === null ? null : `${g.batFirstWinPct}%`)}.`
}

// ---------- match plan (match day) ----------
export function planPrompt(ctx: AiCtx, match: Match): Prompt {
  const careers = careerStats(ctx.files.filter((f) => f.status !== 'live'))
  const squad = match.squad.length ? match.squad : []
  const lines = squad.map((id) => `- ${playerLine(ctx, id, careers)}`)
  const prompt = [
    `MATCH TODAY: ${ctx.teamName} vs ${match.opponent}, ${fmtDate(match.date)}${match.time ? ` at ${match.time}` : ''}${match.venue ? `, ${match.venue}` : ''}${match.overs ? `, ${match.overs} overs` : ''}.`,
    '',
    `OUR SQUAD (${squad.length}):`,
    lines.length ? lines.join('\n') : '- The squad has not been picked yet.',
    '',
    'OUR TEAM SO FAR:',
    teamBlock(ctx),
    '',
    'OPPONENT:',
    opponentBlock(ctx, match),
    '',
    'GROUND:',
    groundBlock(ctx, match),
    '',
    'QUESTIONS',
    'WRITE THESE SECTIONS in this order. Each starts with its "## " heading exactly as shown (leave out the dash and the guidance after it). Be thorough: 4 to 8 bullets per section, each with the reason and the numbers behind it.',
    '## Toss and conditions — bat or bowl first if we win it, and what to do if we lose it; use the ground, the pitch, the overs and how we have done batting first versus chasing.',
    '## Batting order — all players in order from 1 to 11 with one line of reasoning each: who opens, who anchors, who accelerates, who finishes, and where the tail starts.',
    '## Powerplay plan — how to bat and bowl the first overs: which bowlers open and why, what scoring rate to aim for, and how to use the field restrictions.',
    '## Middle overs plan — how to build or squeeze: who bowls which overs (spin or pace, left or right arm), how to rotate the strike, and when to attack.',
    '## Death overs plan — who finishes the innings with the bat and who bowls the last overs, with their numbers in that phase.',
    '## Bowling plan over by over — who bowls each over, keeping each bowler within a fair share of the overs, and who to hold in reserve.',
    '## Opposition — their dangerous players from earlier meetings, how to attack or contain each, and what we learned from the last result.',
    '## Fielding and captaincy — where to place our best fielders and the keeper, field settings for the key moments, and when to change the bowling.',
    '## Risks and Plan B — the three biggest risks (for example early wickets, a weak bowling slot, a slow start) and exactly what to do if each happens.',
    '## Team talk — five short points the captain can say before the toss.',
    '## One line — the plan in one sentence.',
  ].join('\n')
  return { system: SYSTEM, prompt }
}

// ---------- match review (after the match) ----------
function inningsBlock(ctx: AiCtx, file: ScoreFile, idx: number): string {
  const inn = file.innings[idx]
  const s = summarize(file, idx)
  const who = inn.batting === 'home' ? ctx.teamName : file.away.name
  const bat = s.batters
    .filter((b) => b.balls > 0 || b.out)
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 4)
    .map((b) => `${nameOf(ctx, b.id)} ${b.runs}${b.out ? '' : '*'} (${b.balls})`)
    .join(', ')
  const bowl = s.bowlers
    .filter((b) => b.balls > 0)
    .sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)
    .slice(0, 4)
    .map((b) => `${nameOf(ctx, b.id)} ${b.wickets}/${b.runs} in ${Math.floor(b.balls / 6)}.${b.balls % 6}`)
    .join(', ')
  const phases = phaseStats(file, idx)
    .map((p) => `${p.phase.label} ${p.runs}/${p.wickets}`)
    .join(', ')
  const stand = [...s.partnerships].sort((a, b) => b.runs - a.runs)[0]
  return [
    `${who} batted ${idx === 0 ? 'first' : 'second'}: ${s.total}/${s.wickets} in ${s.overs} overs${s.target ? ` (target ${s.target})` : ''}. Extras ${s.extras.total} (${s.extras.wd} wides, ${s.extras.nb} no-balls), all given away by ${inn.batting === 'home' ? file.away.name : ctx.teamName}’s bowlers.${idx === 1 && s.target && file.result?.winner === inn.batting ? ` The chase finished with ${inn.overs * 6 - s.legal} balls to spare.` : ''}`,
    `  Top batters: ${bat || '–'}.`,
    `  Bowlers (${inn.batting === 'home' ? file.away.name : ctx.teamName}): ${bowl || '–'}.`,
    `  By phase (runs/wickets): ${phases}.`,
    stand ? `  Biggest stand: ${stand.runs} runs for wicket ${stand.wicket} (${nameOf(ctx, stand.a)} and ${nameOf(ctx, stand.b)}).` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function reviewPrompt(ctx: AiCtx, match: Match, file: ScoreFile | undefined): Prompt {
  const result = match.result ? `Result: ${match.result}${match.ourScore ? `, ${ctx.teamName} ${match.ourScore}` : ''}${match.theirScore ? `, ${match.opponent} ${match.theirScore}` : ''}.` : 'Result not recorded.'
  const detail = file
    ? [
        `${file.result?.text ?? result}`,
        `Toss: ${file.toss.wonBy === 'home' ? ctx.teamName : file.away.name} won and chose to ${file.toss.chose}.`,
        inningsBlock(ctx, file, 0),
        file.innings[1] ? inningsBlock(ctx, file, 1) : '',
        file.awards?.potm ? `Player of the match: ${nameOf(ctx, file.awards.potm)}.` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : `${result}\nThere is no ball-by-ball record for this match, so only the result is known. Say so, and keep the review short and general.`
  const prompt = [
    `MATCH JUST PLAYED: ${ctx.teamName} vs ${match.opponent}, ${fmtDate(match.date)}${match.venue ? `, ${match.venue}` : ''}.`,
    '',
    detail,
    '',
    'OUR RECORD (all scored matches, this one included when it was scored):',
    teamBlock(ctx),
    '',
    'QUESTIONS',
    'WRITE THESE SECTIONS in this order. Each starts with its "## " heading exactly as shown (leave out the dash and the guidance after it). Be thorough: 4 to 8 bullets per section, each with the reason and the numbers behind it.',
    '## The result in short — what happened and the margin, in a few lines.',
    '## First innings — how it went phase by phase, the best and worst passages, and what the numbers say.',
    '## Second innings — the same for the other innings, including how the chase or defence was managed.',
    '## Turning points — the two or three moments or partnerships where the match swung, and why.',
    '## Batting performances — each batter who made a real contribution or let the team down, with the figures.',
    '## Bowling and fielding — each bowler’s spell judged on economy, wickets and phase, plus catches, extras and discipline.',
    '## Captaincy and tactics — what was done well, and decisions that could have gone differently (toss, order, bowling changes).',
    '## What to fix — five specific things, each with a drill or a change to try before the next match.',
    '## Next match — the one thing to focus on, and who should be ready for a bigger role.',
    '## One line — the match in one sentence.',
  ].join('\n')
  return { system: SYSTEM, prompt }
}

// ---------- player plan (once a week) ----------
export function playerPrompt(ctx: AiCtx, personId: string): Prompt {
  const careers = careerStats(ctx.files.filter((f) => f.status !== 'live'))
  const p = ctx.people.find((x) => x.id === personId)
  const c = careers.get(personId)
  const dismissals = c ? Object.entries(c.dismissals).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) : []
  const goals = (p?.goals ?? []).map((g) => `${g.metric} ${g.target} (${g.period === 'year' ? g.year : 'career'})`)
  const recent = c
    ? [...c.byMatch]
        .sort((a, b) => (ctx.matches.find((m) => m.id === b.matchId)?.date ?? '').localeCompare(ctx.matches.find((m) => m.id === a.matchId)?.date ?? ''))
        .slice(0, 5)
        .map((l) => {
          const m = ctx.matches.find((x) => x.id === l.matchId)
          const parts = [l.bat ? `bat ${l.bat.runs}${l.bat.notOut ? '*' : ''} (${l.bat.balls})` : '', l.bowl ? `bowl ${l.bowl.wickets}/${l.bowl.runs} in ${Math.floor(l.bowl.balls / 6)}.${l.bowl.balls % 6}` : ''].filter(Boolean)
          return `${m ? `vs ${m.opponent}` : 'a match'}: ${parts.join(', ') || 'fielded only'}`
        })
    : []
  const prompt = [
    `PLAYER: ${playerLine(ctx, personId, careers)}`,
    '',
    recent.length ? `RECENT MATCHES (newest first):\n${recent.map((r) => `- ${r}`).join('\n')}` : 'No recent scored matches.',
    dismissals.length ? `HOW THEY GET OUT: ${dismissals.map(([k, n]) => `${WICKET_LABELS[k as keyof typeof WICKET_LABELS] ?? k} ${n}`).join(', ')}.` : '',
    goals.length ? `THEIR OWN GOALS: ${goals.join(', ')}.` : '',
    `TEAM CONTEXT: ${ctx.teamName}. ${teamBlock(ctx).split('\n')[0]}`,
    '',
    'Write this for the player themself, in the second person ("you").',
    'QUESTIONS',
    'WRITE THESE SECTIONS in this order. Each starts with its "## " heading exactly as shown (leave out the dash and the guidance after it). Be thorough: 4 to 8 bullets per section, each with the reason and the numbers behind it.',
    '## Your snapshot — where you stand in the team now, with your key numbers and recent form.',
    '## Batting — strengths, weak spots, how you get out, and how you do in the powerplay, middle and death overs.',
    '## Bowling — wickets, economy and the phases where you are best and worst (skip if you have not bowled).',
    '## Fielding — catches and run-outs, and what to improve.',
    '## Trends — whether you are improving or slipping over the last few matches, with the scores.',
    '## This week in the nets — a day-by-day plan for the next seven days with specific drills for your weak spots.',
    '## Next match approach — how to bat or bowl, and the role to ask the captain for.',
    '## Your goals — if you set goals, how close you are and what it takes; otherwise suggest two sensible targets.',
    '## One line — the advice in one sentence.',
  ]
    .filter((l) => l !== '')
    .join('\n')
  return { system: SYSTEM, prompt }
}

export const KIND_LABEL: Record<AiKind, string> = { plan: 'Match plan', review: 'Match review', player: 'Player plan' }
