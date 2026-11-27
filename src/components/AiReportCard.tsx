// AI report card (match plan, match review, player plan) and the super admin's
// key sheet. Everyone in the team reads a generated report; only admins see the
// button that makes one.
import { useState } from 'react'
import { aiOff, aiOn, aiReady, canPlan, canReview, findReport, generateReport, playerWait, removeAiKey, saveAiConfig, setAiEnabled, type AiRequest } from '../lib/ai'
import { KIND_LABEL } from '../lib/aiPrompts'
import { previewOf, whatsappText } from '../lib/aiText'
import { fmtDate, fmtStamp } from '../lib/dates'
import { DEFAULT_MODEL } from '../lib/gemini'
import { P } from '../lib/paths'
import { useApp, useFile } from '../state/AppContext'
import { navigate } from '../state/router'
import type { AiConfig, AiFile, AiKind, AiReport, Match } from '../types'
import { Markdown } from './Markdown'
import { ErrorNote, Field, Sheet, Toggle } from './ui'

/** A WhatsApp link holds only so much text; longer answers are copied and pasted instead. */
const MAX_LINK = 6000

/** WhatsApp, copy and the phone's own share sheet for one report. */
export function ReportShare({ report, heading }: { report: AiReport; heading: string }) {
  const { toast } = useApp()
  const text = whatsappText(report.text, heading)
  const copy = () =>
    navigator.clipboard
      ?.writeText(text)
      .then(() => true)
      .catch(() => false) ?? Promise.resolve(false)

  async function whatsapp() {
    const link = `https://wa.me/?text=${encodeURIComponent(text)}`
    if (link.length <= MAX_LINK) {
      window.open(link, '_blank', 'noopener')
      return
    }
    // Too long for a link: copy it, open WhatsApp, and the admin pastes.
    toast((await copy()) ? 'Copied — paste it in WhatsApp' : 'Too long to send directly. Use Copy.')
    window.open('https://wa.me/', '_blank', 'noopener')
  }

  async function share() {
    if (navigator.share) await navigator.share({ text }).catch(() => {})
    else toast((await copy()) ? 'Copied' : 'Could not copy')
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn-primary flex-1" onClick={() => void whatsapp()}>
        WhatsApp
      </button>
      <button className="btn-secondary flex-1" onClick={() => void share()}>
        Share
      </button>
      <button className="btn-secondary flex-1" onClick={() => void copy().then((ok) => toast(ok ? 'Copied' : 'Could not copy'))}>
        Copy
      </button>
    </div>
  )
}

interface CardProps {
  teamId: string
  kind: AiKind
  /** The match (plan, review) or the player (player plan). */
  id: string
  /** The match, for the plan and review rules. */
  match?: Match
  /** May this person generate it? The team admin for a match plan and review; a player for their own plan. */
  isAdmin: boolean
}

/** Shows the report if there is one; shows the generate button to the team's admin when it is allowed. */
export function AiReportCard({ teamId, kind, id, match, isAdmin }: CardProps) {
  const { store, personName, toast, teams } = useApp()
  const file = useFile<AiFile>(P.ai(teamId))
  // The key is only read by whoever may generate.
  const cfg = useFile<AiConfig>(isAdmin ? P.aiConfig : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const report = findReport(file?.reports ?? [], kind, id)
  const preview = report ? previewOf(report.text) : { text: '', more: false }
  const team = teams.find((t) => t.id === teamId)
  const heading = `${KIND_LABEL[kind]} · ${kind === 'player' ? personName(id) : `${team?.shortName ?? 'Our team'} vs ${match?.opponent ?? ''}${match ? ', ' + fmtDate(match.date) : ''}`}`
  const wait = kind === 'player' ? playerWait(report) : null
  const allowed = kind === 'plan' ? !!match && canPlan(match) : kind === 'review' ? !!match && canReview(match) && !report : !!wait?.ready
  const off = aiOff(cfg)
  // Switched off by the super admin: no generate button anywhere; saved reports still show.
  const canMake = isAdmin && allowed && !off
  if (!report && !canMake && !(isAdmin && kind === 'player' && !off)) return null

  async function make() {
    if (!store || busy) return
    setBusy(true)
    setError(null)
    try {
      const req: AiRequest = kind === 'player' ? { kind, teamId, personId: id } : { kind, teamId, matchId: id }
      await generateReport(store, req)
      toast(`${KIND_LABEL[kind]} ready`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const label = report ? (kind === 'plan' ? 'Make a new plan' : 'Make a new one') : kind === 'plan' ? 'Get the match plan' : kind === 'review' ? 'Get the match review' : 'Get a plan for this player'
  const blurb =
    kind === 'plan'
      ? 'Toss, batting order, bowling plan and watch-outs, worked out from your squad’s numbers.'
      : kind === 'review'
        ? 'Why the match went the way it did, the turning points and what to fix.'
        : 'Strengths, weak spots and three things to work on this week.'

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">✨ {KIND_LABEL[kind]}</h2>
        {report && <span className="text-xs text-muted">AI suggestion</span>}
      </div>
      {report ? (
        <>
          <Markdown text={preview.text} />
          <div className="flex flex-col gap-2">
            <button className="btn-secondary" onClick={() => navigate(`/teams/${teamId}/ai/${report.id}`)}>
              {preview.more ? 'Show more' : 'Open full screen'}
            </button>
            <ReportShare report={report} heading={heading} />
          </div>
          <p className="border-t border-line pt-2 text-xs text-muted">
            Made {fmtStamp(report.createdAt)}
            {report.createdBy ? ` by ${personName(report.createdBy)}` : ''} from the team’s numbers. It is advice, not a guarantee.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">{blurb}</p>
      )}
      {isAdmin && !off && kind === 'player' && wait && !wait.ready && <p className="text-sm text-muted">Your next plan in {wait.daysLeft} day{wait.daysLeft === 1 ? '' : 's'} (on {fmtDate(wait.nextOn)}).</p>}
      {isAdmin && canMake && !aiReady(cfg) && <p className="text-sm text-warn">AI reports are not set up yet. The super admin adds the Gemini key in Settings → AI reports.</p>}
      <ErrorNote>{error}</ErrorNote>
      {canMake && (
        <button className={report ? 'btn-secondary' : 'btn-primary'} disabled={busy || !aiOn(cfg)} onClick={() => void make()}>
          {busy ? 'Thinking… this can take up to a minute' : label}
        </button>
      )}
    </div>
  )
}

/** Super admin: paste the Gemini key once; every admin then sees the buttons. */
export function AiSetupSheet({ onClose }: { onClose: () => void }) {
  const { store, toast } = useApp()
  const cfg = useFile<AiConfig>(P.aiConfig)
  const [key, setKey] = useState('')
  const [model, setModel] = useState(cfg?.model || DEFAULT_MODEL)
  const [error, setError] = useState<string | null>(null)
  const has = aiReady(cfg)

  return (
    <Sheet title="AI reports" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Admins can then ask for a match plan on the match day, a review after each match and a weekly plan for each player. Get a free key from Google AI Studio (aistudio.google.com), paste it here once, and it is saved in your private data repo.
        </p>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-alt px-3 py-2">
          <div className="min-w-0">
            <p className="font-semibold">AI reports {aiOff(cfg) ? 'are off' : 'are on'}</p>
            <p className="text-xs text-muted">{aiOff(cfg) ? 'No one sees a generate button. Reports already made keep showing.' : 'Admins and players see the generate buttons.'}</p>
          </div>
          <Toggle
            label="AI reports"
            checked={!aiOff(cfg)}
            onChange={(on) => {
              try {
                setAiEnabled(store!, on)
                toast(on ? 'AI reports are on' : 'AI reports are off')
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          />
        </div>
        <p className="text-sm">{has ? `✓ A key is saved (ends …${cfg!.geminiKey.slice(-4)}).` : 'No key saved yet.'}</p>
        <Field label={has ? 'Replace the key' : 'Gemini key'}>
          <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" placeholder="Paste the key" />
        </Field>
        <Field label="Model" hint="Leave as it is unless Google retires it.">
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn-primary"
          disabled={!store || (!key.trim() && !(has && model.trim() !== cfg?.model))}
          onClick={() => {
            try {
              saveAiConfig(store!, { key: key.trim() || cfg!.geminiKey, model })
              setKey('')
              setError(null)
              toast('AI reports are on')
              onClose()
            } catch (e) {
              setError((e as Error).message)
            }
          }}
        >
          Save
        </button>
        {has && (
          <button
            className="btn-secondary"
            onClick={() => {
              try {
                removeAiKey(store!)
                toast('Key removed')
                onClose()
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            Remove the key
          </button>
        )}
      </div>
    </Sheet>
  )
}
