// AI reports: the Gemini key (set once by the super admin, config/ai.json) and the
// reports a team's admin generates (teams/<id>/ai.json), which everyone in the
// team can read. Only admins generate; the write guard keeps everyone else out.
import type { AiConfig, AiFile, AiKind, AiReport, Match, ScoreFile } from '../types'
import { nowStamp, todayISO } from './dates'
import { loadTeam, matchesOf, peopleOf, teamsOf } from './domain'
import { askGemini, DEFAULT_MODEL } from './gemini'
import { planPrompt, playerPrompt, reviewPrompt, type AiCtx, type Prompt } from './aiPrompts'
import { P } from './paths'
import type { Store } from './store'
import { uuid } from './uuid'

// ---------- the key ----------
export const aiConfigOf = (s: Store): AiConfig | null => s.get<AiConfig>(P.aiConfig)
export const aiReady = (cfg: AiConfig | null | undefined): cfg is AiConfig => !!cfg?.geminiKey
/** The super admin has switched the feature off: no new reports anywhere (saved ones still show). */
export const aiOff = (cfg: AiConfig | null | undefined): boolean => cfg?.enabled === false
/** Ready and switched on. */
export const aiOn = (cfg: AiConfig | null | undefined): cfg is AiConfig => aiReady(cfg) && !aiOff(cfg)

export function saveAiConfig(s: Store, input: { key: string; model: string }): void {
  const key = input.key.trim()
  const model = input.model.trim() || DEFAULT_MODEL
  if (key.length < 20 || /\s/.test(key)) throw new Error('That does not look like a Gemini key. Copy it again from Google AI Studio.')
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(model)) throw new Error('The model name can only have letters, numbers, dots and dashes.')
  const cfg: AiConfig = { schemaVersion: 1, geminiKey: key, model, ...(aiConfigOf(s)?.enabled === false ? { enabled: false } : {}), updatedAt: nowStamp() }
  if (!s.write(P.aiConfig, cfg, 'Set up AI reports')) throw new Error('Only the super admin can set the key.')
}

export function removeAiKey(s: Store): void {
  const cfg: AiConfig = { schemaVersion: 1, geminiKey: '', model: aiConfigOf(s)?.model ?? DEFAULT_MODEL, ...(aiConfigOf(s)?.enabled === false ? { enabled: false } : {}), updatedAt: nowStamp() }
  if (!s.write(P.aiConfig, cfg, 'Remove the AI key')) throw new Error('Only the super admin can remove the key.')
}

/** The master switch. Works with or without a key saved yet. */
export function setAiEnabled(s: Store, on: boolean): void {
  const cur = aiConfigOf(s)
  const cfg: AiConfig = { schemaVersion: 1, geminiKey: cur?.geminiKey ?? '', model: cur?.model || DEFAULT_MODEL, ...(on ? {} : { enabled: false }), updatedAt: nowStamp() }
  if (!s.write(P.aiConfig, cfg, on ? 'Turn AI reports on' : 'Turn AI reports off')) throw new Error('Only the super admin can switch this.')
}

// ---------- reports ----------
export const reportsOf = (s: Store, teamId: string): AiReport[] => s.get<AiFile>(P.ai(teamId))?.reports ?? []

export function findReport(reports: AiReport[], kind: AiKind, id: string): AiReport | undefined {
  return reports.find((r) => r.kind === kind && (kind === 'player' ? r.personId === id : r.matchId === id))
}

function putReport(s: Store, teamId: string, kind: AiKind, id: string, text: string, model: string): AiReport {
  const all = reportsOf(s, teamId)
  const old = findReport(all, kind, id)
  const now = nowStamp()
  const report: AiReport = {
    id: old?.id ?? uuid(),
    teamId,
    kind,
    ...(kind === 'player' ? { personId: id } : { matchId: id }),
    text,
    model,
    createdBy: s.actor.personId ?? '',
    createdAt: now,
    updatedAt: now,
  }
  const reports = [...all.filter((r) => r.id !== report.id), report]
  if (!s.write(P.ai(teamId), { schemaVersion: 1, reports } satisfies AiFile, `AI ${kind}`)) throw new Error('You can’t save this report.')
  return report
}

// ---------- when each one may be generated ----------
/** The match plan is offered on the match day, before the match is completed. */
export const canPlan = (m: Match, today = todayISO()): boolean => !m.cancelled && m.date === today && m.lifecycle === 'scheduled' && m.scoring !== 'finished'

/** The review is offered once the match is marked complete. */
export const canReview = (m: Match): boolean => !m.cancelled && m.lifecycle === 'completed'

export const PLAYER_WAIT_DAYS = 7

/** A player's plan can be made again a week after the last one. */
export function playerWait(report: AiReport | undefined, now = Date.now()): { ready: boolean; daysLeft: number; nextOn: string } {
  if (!report) return { ready: true, daysLeft: 0, nextOn: '' }
  const next = new Date(report.createdAt).getTime() + PLAYER_WAIT_DAYS * 86_400_000
  const left = next - now
  const nextOn = todayISO(new Date(next))
  return left <= 0 ? { ready: true, daysLeft: 0, nextOn } : { ready: false, daysLeft: Math.max(1, Math.ceil(left / 86_400_000)), nextOn }
}

// ---------- generating ----------
export type AiRequest = { kind: 'plan' | 'review'; teamId: string; matchId: string } | { kind: 'player'; teamId: string; personId: string }

async function context(s: Store, teamId: string): Promise<AiCtx & { scoreOf: (matchId: string) => ScoreFile | undefined }> {
  await loadTeam(s, teamId)
  const matches = matchesOf(s, teamId)
  const scored = matches.filter((m) => m.scoring && !m.cancelled)
  await Promise.all(scored.map((m) => s.load(P.scoring(teamId, m.id)).catch(() => null)))
  const files = scored.map((m) => s.get<ScoreFile>(P.scoring(teamId, m.id))).filter((f): f is ScoreFile => !!f)
  const team = teamsOf(s).find((t) => t.id === teamId)
  return { teamName: team?.name ?? 'Our team', files, matches, people: peopleOf(s), scoreOf: (id) => files.find((f) => f.matchId === id) }
}

/** Works out the facts, asks Gemini, and saves the answer where the whole team can read it. */
export async function generateReport(s: Store, req: AiRequest, fetcher?: typeof fetch): Promise<AiReport> {
  if (!aiConfigOf(s)) await s.load(P.aiConfig).catch(() => null)
  const cfg = aiConfigOf(s)
  if (aiOff(cfg)) throw new Error('AI reports are switched off.')
  if (!aiReady(cfg)) throw new Error('AI reports are not set up yet. The super admin adds the Gemini key in Settings → AI reports.')
  const ctx = await context(s, req.teamId)

  let prompt: Prompt
  let id: string
  if (req.kind === 'player') {
    const wait = playerWait(findReport(reportsOf(s, req.teamId), 'player', req.personId))
    if (!wait.ready) throw new Error(`This player’s plan can be made again in ${wait.daysLeft} day${wait.daysLeft === 1 ? '' : 's'}.`)
    prompt = playerPrompt(ctx, req.personId)
    id = req.personId
  } else {
    const match = ctx.matches.find((m) => m.id === req.matchId)
    if (!match) throw new Error('Match not found.')
    if (req.kind === 'plan') {
      if (!canPlan(match)) throw new Error('The match plan can be made on the match day, before the match is completed.')
      prompt = planPrompt(ctx, match)
    } else {
      if (!canReview(match)) throw new Error('The review can be made once the match is marked complete.')
      if (findReport(reportsOf(s, req.teamId), 'review', match.id)) throw new Error('This match already has a review.')
      prompt = reviewPrompt(ctx, match, ctx.scoreOf(match.id))
    }
    id = match.id
  }

  const text = await askGemini({ key: cfg.geminiKey, model: cfg.model || DEFAULT_MODEL, system: prompt.system, prompt: prompt.prompt, fetcher })
  return putReport(s, req.teamId, req.kind, id, text, cfg.model || DEFAULT_MODEL)
}
