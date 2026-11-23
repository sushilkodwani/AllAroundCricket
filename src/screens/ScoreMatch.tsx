// The scorer's screen (PLAN §25): one tap per ball, with the app doing the
// bookkeeping — strike, overs, next batter, next bowler, innings and result.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AwardsEditor } from '../components/Awards'
import { AddPlayerSheet, BallChip, GroundMap, PressureStrip } from '../components/scoring'
import { HeaderButton, Screen } from '../components/Screen'
import { ChoiceChips, Confirm, Empty, Field, NumberInput, Pill, SearchSelect, Segmented, Sheet, Toggle } from '../components/ui'
import { addOpponentPlayers, setBatsLeft, setBowlStyle } from '../lib/domain'
import { milestoneText, milestonesOf, parScore } from '../lib/insights'
import { P } from '../lib/paths'
import { economy, fmtRate, shotRegion, strikeRate, summarize, type BatLine, type BowlLine } from '../lib/scorecard'
import { applyScore } from '../lib/scoreDomain'
import {
  BALLS,
  FIELDER_REQUIRED,
  NO_BALL_WICKETS,
  WIDE_WICKETS,
  addBall,
  addToXi,
  atOverStart,
  availableBatters,
  battingSide,
  bowlerBlock,
  bowlingRule,
  bowlingRuleText,
  bowlingSide,
  canUndo,
  currentIndex,
  editBall,
  endInnings,
  isFreeHit,
  oversBowledBy,
  oversText,
  other,
  penalty,
  previousOverBowler,
  retire,
  setAllDirections,
  setCrease,
  setOvers,
  setTarget,
  startSecondInnings,
  swapStrike,
  undo,
  type BallInput,
} from '../lib/scoring'
import { useApp, useFile, useTeam } from '../state/AppContext'
import { navigate, useRoute, useSheet, withQuery } from '../state/router'
import { BOWL_LABELS, WICKET_LABELS, type BallEvent, type BowlStyle, type ScoreFile, type SideKey, type WicketKind } from '../types'

type Role = 'striker' | 'nonStriker' | 'bowler'
const ROLE_LABEL: Record<Role, string> = { striker: 'striker', nonStriker: 'non-striker', bowler: 'bowler' }
const PAD_KINDS: WicketKind[] = ['bowled', 'caught', 'caught_behind', 'caught_bowled', 'lbw', 'stumped', 'run_out', 'hit_wicket', 'obstructing']
const KEEPER_KINDS: WicketKind[] = ['caught_behind', 'stumped']

/** Keeps the phone awake while scoring, where the browser allows it. */
function useWakeLock() {
  useEffect(() => {
    type Lock = { release: () => Promise<void> }
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Lock> } }
    let lock: Lock | null = null
    const request = () => {
      if (document.visibilityState !== 'visible') return
      nav.wakeLock
        ?.request('screen')
        .then((l) => {
          lock = l
        })
        .catch(() => {})
    }
    request()
    document.addEventListener('visibilitychange', request)
    return () => {
      document.removeEventListener('visibilitychange', request)
      void lock?.release().catch(() => {})
    }
  }, [])
}

export function ScoreMatch({ teamId, matchId }: { teamId: string; matchId: string }) {
  const { canManage, store, people, personName, toast, session } = useApp()
  const isAdmin = canManage(teamId)
  const route = useRoute()
  const sheet = useSheet()
  const data = useTeam(teamId)
  const path = P.scoring(teamId, matchId)
  const file = useFile<ScoreFile>(path)
  const loaded = !!store?.has(path)
  const base = `/teams/${teamId}/matches/${matchId}`
  const canScore = isAdmin || data.matches.find((m) => m.id === matchId)?.scorerId === session?.personId
  const [pending, setPending] = useState<BallInput | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  // A picked batter or bowler whose profile lacks the batting hand / bowling style: asked before they start.
  const [ask, setAsk] = useState<{ id: string; role: Role } | null>(null)
  const skipped = useRef(new Set<string>())
  const prompted = useRef('')
  useWakeLock()

  const idx = file ? currentIndex(file) : 0
  const inn = file?.innings[idx]
  const summary = useMemo(() => (file ? summarize(file, idx) : null), [file, idx])
  const lefties = useMemo(() => new Set(people.filter((p) => p.batsLeft).map((p) => p.id)), [people])

  const need: Role | null = !inn || inn.closed ? null : !inn.crease.striker ? 'striker' : !inn.crease.nonStriker ? 'nonStriker' : !inn.crease.bowler ? 'bowler' : null

  // Open the right picker by itself after a wicket or at the end of an over —
  // once per situation, so dismissing it does not bring it straight back.
  const sheetName = sheet.name
  const openSheet = sheet.open
  const key = `${idx}:${inn?.events.length ?? 0}:${need}`
  useEffect(() => {
    if (!canScore || !need || sheetName || prompted.current === key) return
    prompted.current = key
    openSheet('pick', need)
  }, [canScore, need, sheetName, key, openSheet])

  // No score file → scoring has not been set up for this match.
  useEffect(() => {
    if (loaded && !file) navigate(`${base}/setup`, { replace: true })
  }, [loaded, file, base])

  if (data.ready && !canScore) {
    return (
      <Screen title="Scoring" back={base}>
        <Empty icon="🔒" title="Not your match to score" text="Only the admin or the chosen scorer can score. Open the scorecard to follow the match." action={<button className="btn-primary" onClick={() => navigate(`${base}/live`, { replace: true })}>View scorecard</button>} />
      </Screen>
    )
  }
  if (!file || !inn || !summary || !store) {
    return (
      <Screen title="Scoring" back={base}>
        <p className="p-10 text-center text-sm text-muted">Loading…</p>
      </Screen>
    )
  }

  const bat = battingSide(file, inn)
  const bowl = bowlingSide(file, inn)
  const freeHit = isFreeHit(inn)
  // The over in progress — or, between overs, the one just finished.
  const overBalls = summary.overLines.length ? summary.overLines[summary.overLines.length - 1].balls : []
  const lineOf = (id?: string): BatLine | undefined => summary.batters.find((b) => b.id === id)
  const bowlOf = (id?: string): BowlLine | undefined => summary.bowlers.find((b) => b.id === id)

  /** Sheets chain with replace, so one Back always returns to the pad. */
  const show = (name: string, arg?: string) => (sheet.name ? navigate(withQuery(route, { sheet: name, arg: arg ?? null }), { replace: true }) : sheet.open(name, arg))
  const hide = () => {
    if (sheet.name) sheet.close()
  }

  function run(step: (f: ScoreFile) => ScoreFile, message = `Score vs ${file!.away.name}`): boolean {
    try {
      applyScore(store!, teamId, matchId, step, message)
      return true
    } catch (e) {
      toast((e as Error).message)
      return false
    }
  }

  /** Saves the answer to the profile (if allowed), then puts the player in the middle as they were picked to be. */
  function finishAsk(save?: () => void) {
    const a = ask
    if (!a) return
    if (save) {
      try {
        save()
      } catch (e) {
        toast((e as Error).message || 'Could not save this to the profile')
      }
    } else {
      skipped.current.add(`${a.role === 'bowler' ? 'bowl' : 'bat'}:${a.id}`)
    }
    setAsk(null)
    if (run((f) => setCrease(f, { [a.role]: a.id }))) hide()
  }

  /**
   * Every delivery goes through here. A four or six first asks where it went; so do 1s, 2s and 3s when
   * the match asks for every direction (the scorer may skip those).
   */
  function commit(input: BallInput, skipShot = false) {
    const offBat = input.kind !== 'wd' && !input.shot && !input.wicket
    const boundary = input.bat === 4 || input.bat === 6
    const small = !!file!.allDirections && !skipShot && (input.bat ?? 0) >= 1 && (input.bat ?? 0) <= 3
    if (offBat && (boundary || small)) {
      setPending(input)
      show('shot')
      return
    }
    let next: ScoreFile
    try {
      next = applyScore(store!, teamId, matchId, (f) => addBall(f, input), `Score vs ${file!.away.name}`)
    } catch (e) {
      toast((e as Error).message)
      return
    }
    // Fifty, hundred, hat-trick, five wickets, team 50s: say so as it happens.
    const events = next.innings[idx].events
    const reached = milestonesOf(next, idx).get(events[events.length - 1].id)
    if (reached) toast(reached.map((m) => milestoneText(m, personName, bat.name)).join('  '))
    setPending(null)
    hide()
  }

  const ready = !need && !inn.closed
  const padBtn = 'flex min-h-[54px] items-center justify-center rounded-xl border border-chip-line bg-chip text-lg font-bold active:bg-line disabled:opacity-40'
  const striker = inn.crease.striker
  const editing = sheet.name === 'editball' ? (inn.events.find((e) => e.t === 'ball' && e.id === sheet.arg) as BallEvent | undefined) : undefined

  return (
    <Screen
      title={`${file.home.shortName} v ${file.away.shortName}`}
      back={base}
      actions={
        <HeaderButton label="Scoring options" onClick={() => show('menu')}>
          ⋯
        </HeaderButton>
      }
    >
      <div className="flex flex-col gap-3 p-3">
        {/* ----- score ----- */}
        <div className="card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate font-semibold">{bat.name}</span>
            <span className="text-xs text-muted">{idx === 0 ? '1st innings' : '2nd innings'}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-bold">
              {summary.total}/{summary.wickets}
            </span>
            <span className="text-muted">
              ({summary.overs}/{inn.overs} ov)
            </span>
            <span className="ml-auto text-sm text-muted">CRR {fmtRate(summary.runRate)}</span>
          </div>
          {summary.need && file.status === 'live' && (
            <p className="mt-1 text-sm">
              Need <strong>{summary.need.runs}</strong> from <strong>{summary.need.balls}</strong> balls · RRR {fmtRate(summary.need.rate)}
              {inn.target !== undefined && (() => {
                const par = parScore(inn.target, inn.overs, summary.legal)
                const ahead = summary.total - par
                return (
                  <>
                    {' '}
                    · Par <strong>{par}</strong> <span className={ahead >= 0 ? 'text-ok' : 'text-bad'}>({ahead > 0 ? `+${ahead}` : ahead})</span>
                  </>
                )
              })()}
            </p>
          )}
          {freeHit && ready && (
            <p className="mt-2">
              <Pill tone="warn">FREE HIT</Pill>
            </p>
          )}
        </div>

        {file.status === 'break' && (
          <div className="card flex flex-col gap-3 p-4 text-center">
            <p className="font-semibold">Innings break</p>
            <p className="text-sm text-muted">
              {bowl.name} need {summary.total + 1} to win from {file.overs} overs.
            </p>
            <button className="btn-primary" onClick={() => run(startSecondInnings)}>
              Start 2nd innings
            </button>
          </div>
        )}
        {file.status === 'finished' && (
          <div className="card flex flex-col gap-3 p-4 text-center">
            <p className="text-lg font-bold">{file.result?.text}</p>
            <p className="text-sm text-muted">The result and both scores are saved on the match.</p>
            <button className="btn-primary" onClick={() => navigate(`${base}/live`)}>
              View scorecard
            </button>
          </div>
        )}
        {file.status === 'finished' && <AwardsEditor key={file.result?.text} file={file} onSave={(awards) => run((f) => ({ ...f, awards, updatedAt: new Date().toISOString() }), 'Match awards')} />}

        {/* ----- who is in the middle ----- */}
        {!inn.closed && (
          <div className="card divide-y divide-line overflow-hidden text-sm">
            {(['striker', 'nonStriker'] as const).map((role) => {
              const id = inn.crease[role]
              const l = lineOf(id)
              return (
                <button key={role} className="row min-h-[44px] py-2 active:bg-alt" onClick={() => show('pick', role)}>
                  <span className="w-4 text-accent">{role === 'striker' ? '🏏' : ''}</span>
                  {id ? (
                    <>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {personName(id)}
                        {role === 'striker' && '*'}
                      </span>
                      <span>
                        <strong>{l?.runs ?? 0}</strong> <span className="text-muted">({l?.balls ?? 0})</span>
                      </span>
                      <span className="w-14 text-right text-xs text-muted">SR {strikeRate(l?.runs ?? 0, l?.balls ?? 0)}</span>
                    </>
                  ) : (
                    <span className="flex-1 font-semibold text-accent">Pick {ROLE_LABEL[role]}</span>
                  )}
                </button>
              )
            })}
            <button className="row min-h-[44px] py-2 active:bg-alt" onClick={() => show('pick', 'bowler')}>
              <span className="w-4">⚾</span>
              {inn.crease.bowler ? (
                <>
                  <span className="min-w-0 flex-1 truncate font-medium">{personName(inn.crease.bowler)}</span>
                  <span className="text-muted">{figures(bowlOf(inn.crease.bowler))}</span>
                </>
              ) : (
                <span className="flex-1 font-semibold text-accent">Pick bowler</span>
              )}
            </button>
          </div>
        )}

        {!inn.closed && <PressureStrip file={file} idx={idx} />}

        {/* ----- this over ----- */}
        <div className="flex min-h-[36px] items-center gap-1.5 overflow-x-auto">
          <span className="shrink-0 text-xs font-semibold uppercase text-muted">{atOverStart(inn) && overBalls.length ? 'Last over' : 'This over'}</span>
          {overBalls.length === 0 && <span className="text-xs text-muted">—</span>}
          {overBalls.map((b) => (
            <BallChip key={b.id} ball={b} onClick={() => show('editball', b.id)} />
          ))}
        </div>

        {/* ----- the pad ----- */}
        {!inn.closed && (
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((n) => (
              <button key={n} className={padBtn} disabled={!ready} onClick={() => commit({ bat: n })}>
                {n}
              </button>
            ))}
            <button className={`${padBtn} !bg-ink !text-bg`} disabled={!ready} onClick={() => commit({ bat: 4 })}>
              4
            </button>
            <button className={`${padBtn} !border-brand !bg-brand !text-on-brand`} disabled={!ready} onClick={() => commit({ bat: 6 })}>
              6
            </button>
            <button className={`${padBtn} text-sm`} disabled={!ready} onClick={() => show('more')}>
              5, 7…
            </button>
            <button className={`${padBtn} text-sm`} disabled={!ready} onClick={() => run(swapStrike)}>
              ⇄ Strike
            </button>
            {(
              [
                ['wd', 'Wide'],
                ['nb', 'No ball'],
                ['b', 'Bye'],
                ['lb', 'Leg bye'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={`${padBtn} text-sm`} disabled={!ready} onClick={() => show('extra', k)}>
                {label}
              </button>
            ))}
            <button
              className={`${padBtn} col-span-2 !border-bad text-bad`}
              disabled={!ready}
              onClick={() => {
                setPending({ kind: 'legal' })
                show('wicket')
              }}
            >
              Wicket
            </button>
            <button className={`${padBtn} col-span-2 text-base`} disabled={!canUndo(file)} onClick={() => run(undo, 'Undo')}>
              ↩ Undo
            </button>
          </div>
        )}
        {inn.closed && (
          <button className="btn-secondary" disabled={!canUndo(file)} onClick={() => run(undo, 'Undo')}>
            ↩ Undo last ball
          </button>
        )}
      </div>

      {/* ----- sheets ----- */}
      {sheet.name === 'pick' && !ask && (sheet.arg === 'striker' || sheet.arg === 'nonStriker' || sheet.arg === 'bowler') && (
        <PickSheet
          file={file}
          role={sheet.arg}
          batLines={summary.batters}
          bowlLines={summary.bowlers}
          onClose={sheet.close}
          onPick={(id) => {
            const role = sheet.arg as Role
            const person = people.find((x) => x.id === id)
            const missing = role === 'bowler' ? !person?.bowlStyle : person?.batsLeft === undefined
            if (missing && !skipped.current.has(`${role === 'bowler' ? 'bowl' : 'bat'}:${id}`)) {
              setAsk({ id, role })
              return
            }
            if (run((f) => setCrease(f, { [role]: id }))) hide()
          }}
          onAdd={() => show('addplayer', `${sheet.arg === 'bowler' ? other(inn.batting) : inn.batting}:${sheet.arg}`)}
        />
      )}

      {ask && (
        <Sheet title={ask.role === 'bowler' ? `How does ${personName(ask.id)} bowl?` : `Which hand does ${personName(ask.id)} bat with?`} onClose={() => setAsk(null)}>
          <p className="mb-3 text-sm text-muted">
            This isn’t on {personName(ask.id)}’s profile yet. It is saved there, so it is only asked once.
          </p>
          {ask.role === 'bowler' ? (
            <div className="grid grid-cols-2 gap-2">
              {(['rf', 'lf', 'rm', 'lm', 'ro', 'lo', 'rl', 'lw'] as BowlStyle[]).map((k) => (
                <button key={k} className="min-h-[48px] rounded-xl border border-chip-line bg-chip px-2 text-sm font-medium active:bg-line" onClick={() => finishAsk(() => setBowlStyle(store, ask.id, k))}>
                  {BOWL_LABELS[k]}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Right-handed', false],
                ['Left-handed', true],
              ].map(([label, left]) => (
                <button key={String(label)} className="min-h-[52px] rounded-xl border border-chip-line bg-chip px-2 text-base font-semibold active:bg-line" onClick={() => finishAsk(() => setBatsLeft(store, ask.id, left as boolean))}>
                  {label as string}
                </button>
              ))}
            </div>
          )}
          <button className="btn-ghost mt-3 w-full" onClick={() => finishAsk(undefined)}>
            Skip for now
          </button>
        </Sheet>
      )}

      {sheet.name === 'addplayer' && (
        <AddPlayerSheet
          title="Add player"
          phoneOptional={(sheet.arg ?? '').startsWith('away')}
          onClose={sheet.close}
          onAdded={(person, existed) => {
            const [side, role] = (sheet.arg ?? '').split(':') as [SideKey, Role]
            if (!run((f) => addToXi(f, side, person.id), `Add ${person.name} to the match`)) return
            if (side === 'away' && file.opponentId) addOpponentPlayers(store, file.opponentId, [person.id])
            toast(existed ? `Already in the app: ${person.name} — added` : `${person.name} added`)
            show('pick', role)
          }}
        />
      )}

      {sheet.name === 'more' && (
        <Sheet title="Runs off the bat" onClose={sheet.close}>
          <div className="grid grid-cols-4 gap-2">
            {[5, 7, 8].map((n) => (
              <button key={n} className={padBtn} onClick={() => commit({ bat: n })}>
                {n}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">For overthrows and the like. Byes and leg-byes have their own buttons.</p>
        </Sheet>
      )}

      {sheet.name === 'extra' && (
        <ExtraSheet
          kind={sheet.arg as 'wd' | 'nb' | 'b' | 'lb'}
          onClose={sheet.close}
          onCommit={(input) => commit(input)}
          onWicket={(input) => {
            setPending(input)
            show('wicket')
          }}
        />
      )}

      {sheet.name === 'wicket' && (
        <WicketSheet
          file={file}
          delivery={pending ?? { kind: 'legal' }}
          freeHit={freeHit}
          onClose={sheet.close}
          onCommit={(input, keeper) => {
            const ok = run((f) => {
              const next = addBall(f, input)
              const side = other(inn.batting)
              return keeper && next[side].keeperId !== keeper ? { ...next, [side]: { ...next[side], keeperId: keeper } } : next
            })
            if (ok) {
              setPending(null)
              hide()
            }
          }}
        />
      )}

      {sheet.name === 'shot' && pending && striker && (
        <ShotSheet
          runs={pending.bat ?? 4}
          batter={personName(striker)}
          left={lefties.has(striker)}
          onLeft={(v) => setBatsLeft(store, striker, v)}
          onClose={sheet.close}
          onSave={(shot) => commit({ ...pending, shot })}
          onSkip={() => commit(pending, true)}
        />
      )}

      {editing && (
        <EditBallSheet
          ball={editing}
          left={lefties.has(editing.striker)}
          allDirections={!!file.allDirections}
          onClose={sheet.close}
          onSave={(patch) => {
            if (run((f) => editBall(f, idx, editing.id, patch), 'Correct a ball')) hide()
          }}
        />
      )}

      {sheet.name === 'menu' && (
        <Sheet title="Scoring options" onClose={sheet.close}>
          <div className="flex flex-col gap-2">
            <button className="btn-secondary" onClick={() => navigate(`${base}/live`, { replace: true })}>
              View scorecard
            </button>
            {!inn.closed && (
              <>
                <button className="btn-secondary" disabled={!inn.crease.striker && !inn.crease.nonStriker} onClick={() => show('retire')}>
                  Retire a batter
                </button>
                <button className="btn-secondary" onClick={() => show('pick', 'bowler')}>
                  Change bowler
                </button>
                <button className="btn-secondary" onClick={() => show('penalty')}>
                  Penalty runs
                </button>
                <button className="btn-secondary" onClick={() => show('overs')}>
                  Change overs ({inn.overs})
                </button>
                {idx === 1 && (
                  <button className="btn-secondary" onClick={() => show('target')}>
                    Revised target ({inn.target})
                  </button>
                )}
                <button className="btn-danger" onClick={() => setConfirmEnd(true)}>
                  End innings now
                </button>
              </>
            )}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
              <span className="min-w-0">
                Ask where 1s, 2s and 3s went
                <span className="block text-xs text-muted">For the wagon wheel. You can skip any ball.</span>
              </span>
              <Toggle checked={!!file.allDirections} onChange={(v) => run((f) => setAllDirections(f, v), v ? 'Ask every shot direction' : 'Ask boundary directions only')} label="Ask where 1s, 2s and 3s went" />
            </div>
            <p className="px-1 text-xs text-muted">Tap a ball in “This over” to correct its runs. Undo steps back one ball at a time, as far as needed.</p>
          </div>
        </Sheet>
      )}

      {sheet.name === 'retire' && (
        <RetireSheet
          batters={[inn.crease.striker, inn.crease.nonStriker].filter((x): x is string => !!x)}
          onClose={sheet.close}
          onRetire={(who, out) => {
            if (run((f) => retire(f, who, out), `${personName(who)} retired`)) hide()
          }}
        />
      )}

      {sheet.name === 'penalty' && (
        <PenaltySheet
          batting={bat.name}
          fielding={bowl.name}
          onClose={sheet.close}
          onAdd={(runs, to) => {
            if (run((f) => penalty(f, runs, to), 'Penalty runs')) hide()
          }}
        />
      )}

      {(sheet.name === 'overs' || sheet.name === 'target') && (
        <NumberSheet
          title={sheet.name === 'overs' ? 'Overs for this innings' : 'Revised target'}
          hint={sheet.name === 'overs' ? `${oversText(summary.legal)} overs bowled so far.` : 'Runs the chasing side needs to win.'}
          initial={sheet.name === 'overs' ? inn.overs : (inn.target ?? 0)}
          onClose={sheet.close}
          onSave={(n) => {
            if (run((f) => (sheet.name === 'overs' ? setOvers(f, n) : setTarget(f, n)), sheet.name === 'overs' ? 'Change overs' : 'Revised target')) hide()
          }}
        />
      )}

      {confirmEnd && (
        <Confirm
          title="End this innings?"
          message={`${bat.name} ${summary.total}/${summary.wickets} after ${summary.overs} overs. You can undo this.`}
          confirmLabel="End innings"
          danger
          onCancel={() => setConfirmEnd(false)}
          onConfirm={() => {
            setConfirmEnd(false)
            if (run(endInnings, 'End innings')) hide()
          }}
        />
      )}
    </Screen>
  )
}

const figures = (l?: BowlLine) => (l ? `${oversText(l.balls)}-${l.maidens}-${l.runs}-${l.wickets}` : '0.0-0-0-0')

// ---------- pick a batter / bowler ----------
function PickSheet({ file, role, batLines, bowlLines, onPick, onAdd, onClose }: { file: ScoreFile; role: Role; batLines: BatLine[]; bowlLines: BowlLine[]; onPick: (id: string) => void; onAdd: () => void; onClose: () => void }) {
  const { personName } = useApp()
  const inn = file.innings[currentIndex(file)]
  const isBowler = role === 'bowler'
  const blocked = isBowler && atOverStart(inn) ? previousOverBowler(inn) : undefined
  const rule = bowlingRule(inn.overs, bowlingSide(file, inn).xi.length)
  const bowled = oversBowledBy(inn)
  const ids = isBowler ? bowlingSide(file, inn).xi : availableBatters(file, inn)
  return (
    <Sheet title={`Pick the ${ROLE_LABEL[role]}`} onClose={onClose}>
      <div className="card divide-y divide-line overflow-hidden">
        {ids.length === 0 && <p className="px-4 py-5 text-center text-sm text-muted">No one left to pick.</p>}
        {ids.map((id) => {
          const bl = bowlLines.find((l) => l.id === id)
          const bt = batLines.find((l) => l.id === id)
          const limit = isBowler && id !== blocked ? bowlerBlock(file, inn, id) : null
          const count = bowled.get(id) ?? 0
          return (
            <button key={id} className="row active:bg-alt disabled:opacity-40" disabled={id === blocked || !!limit} onClick={() => onPick(id)}>
              <span className="min-w-0 flex-1 truncate">
                {personName(id)}
                {id === inn.crease.bowler && isBowler && <span className="text-muted"> (bowling)</span>}
              </span>
              {id === blocked && <span className="text-xs text-muted">bowled last over</span>}
              {limit && id !== blocked && <Pill tone="warn">{count >= rule.max ? `${rule.max} ov done` : 'limit reached'}</Pill>}
              {isBowler && bl && <span className="text-sm text-muted">{figures(bl)}</span>}
              {!isBowler && bt?.retiredHurt && <Pill tone="warn">retired hurt</Pill>}
              {!isBowler && bt && (
                <span className="text-sm text-muted">
                  {bt.runs} ({bt.balls})
                </span>
              )}
            </button>
          )
        })}
      </div>
      <button className="btn-ghost mt-2 w-full" onClick={onAdd}>
        + Add a player (name and number)
      </button>
      {isBowler && <p className="mt-1 px-1 text-xs text-muted">A bowler can’t bowl two overs in a row. {bowlingRuleText(rule)} At least five bowlers share the overs.</p>}
    </Sheet>
  )
}

// ---------- extras ----------
function ExtraSheet({ kind, onCommit, onWicket, onClose }: { kind: 'wd' | 'nb' | 'b' | 'lb'; onCommit: (input: BallInput) => void; onWicket: (input: BallInput) => void; onClose: () => void }) {
  const [how, setHow] = useState<'bat' | 'b' | 'lb'>('bat')
  const btn = 'flex min-h-[54px] items-center justify-center rounded-xl border border-chip-line bg-chip text-lg font-bold active:bg-line'
  if (kind === 'b' || kind === 'lb') {
    return (
      <Sheet title={kind === 'b' ? 'Byes' : 'Leg byes'} onClose={onClose}>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} className={btn} onClick={() => onCommit({ byes: n, byeType: kind })}>
              {n}
            </button>
          ))}
        </div>
      </Sheet>
    )
  }
  if (kind === 'wd') {
    return (
      <Sheet title="Wide" onClose={onClose}>
        <p className="mb-2 text-sm text-muted">Runs the batters ran (or 4 if it went to the boundary), on top of the 1 for the wide.</p>
        <div className="grid grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4].map((n) => (
            <button key={n} className={btn} onClick={() => onCommit({ kind: 'wd', byes: n })}>
              {n === 0 ? 'wd' : `+${n}`}
            </button>
          ))}
        </div>
        <button className="btn-danger mt-3 w-full" onClick={() => onWicket({ kind: 'wd' })}>
          Wicket on this wide (stumped, run out…)
        </button>
      </Sheet>
    )
  }
  return (
    <Sheet title="No ball" onClose={onClose}>
      <p className="mb-2 text-sm text-muted">1 run for the no-ball, plus:</p>
      <Segmented
        options={[
          { value: 'bat', label: 'Off the bat' },
          { value: 'b', label: 'Byes' },
          { value: 'lb', label: 'Leg byes' },
        ]}
        value={how}
        onChange={setHow}
      />
      <div className="mt-3 grid grid-cols-4 gap-2">
        {(how === 'bat' ? [0, 1, 2, 3, 4, 6] : [1, 2, 3, 4]).map((n) => (
          <button key={n} className={btn} onClick={() => onCommit(how === 'bat' ? { kind: 'nb', bat: n } : { kind: 'nb', byes: n, byeType: how })}>
            {n === 0 ? 'nb' : `+${n}`}
          </button>
        ))}
      </div>
      <button className="btn-danger mt-3 w-full" onClick={() => onWicket({ kind: 'nb' })}>
        Run out on this no-ball
      </button>
    </Sheet>
  )
}

// ---------- wicket ----------
function WicketSheet({ file, delivery, freeHit, onCommit, onClose }: { file: ScoreFile; delivery: BallInput; freeHit: boolean; onCommit: (input: BallInput, keeper?: string) => void; onClose: () => void }) {
  const { personName } = useApp()
  const inn = file.innings[currentIndex(file)]
  const fielders = bowlingSide(file, inn)
  const dk = delivery.kind ?? 'legal'
  const allowed = PAD_KINDS.filter((k) => (dk === 'wd' ? WIDE_WICKETS.includes(k) : dk === 'nb' || freeHit ? NO_BALL_WICKETS.includes(k) : true))
  const [kind, setKind] = useState<WicketKind | undefined>(allowed.length <= 2 ? 'run_out' : undefined)
  const [who, setWho] = useState(inn.crease.striker)
  const [runs, setRuns] = useState(0)
  const [fielder, setFielder] = useState<string | undefined>()
  const [at, setAt] = useState<[number, number] | null>(null)
  const byBatter = kind === 'run_out' || kind === 'obstructing'
  const fielderShown = kind && FIELDER_REQUIRED.includes(kind)
  const chosenFielder = fielder ?? (kind && KEEPER_KINDS.includes(kind) ? fielders.keeperId : undefined)

  const ready = !!kind && (!byBatter || !!who) && (!fielderShown || !!chosenFielder)

  function confirm() {
    if (!kind || !ready) return
    const placed = kind === 'caught' || kind === 'run_out'
    const input: BallInput = { ...delivery, wicket: { kind, who: byBatter ? who : undefined, fielder: fielderShown ? chosenFielder : undefined, at: placed && at ? at : undefined } }
    if (byBatter && runs > 0) {
      if (dk === 'wd' || delivery.byes) input.byes = (delivery.byes ?? 0) + runs
      else input.bat = runs
    }
    onCommit(input, KEEPER_KINDS.includes(kind) ? chosenFielder : undefined)
  }

  return (
    <Sheet title={dk === 'wd' ? 'Wicket on a wide' : dk === 'nb' ? 'Wicket on a no-ball' : freeHit ? 'Wicket (free hit)' : 'Wicket'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ChoiceChips options={allowed.map((k) => ({ value: k, label: WICKET_LABELS[k] }))} value={kind} onChange={setKind} />
        {byBatter && (
          <>
            <div>
              <span className="label">Who is out?</span>
              <ChoiceChips options={[inn.crease.striker, inn.crease.nonStriker].filter((id): id is string => !!id).map((id) => ({ value: id, label: personName(id) }))} value={who} onChange={setWho} />
            </div>
            <div>
              <span className="label">Runs completed before the wicket</span>
              <ChoiceChips options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))} value={String(runs)} onChange={(v) => setRuns(Number(v))} />
            </div>
          </>
        )}
        {fielderShown && (
          <div>
            <span className="label">{kind === 'run_out' ? 'Run out by' : KEEPER_KINDS.includes(kind!) ? 'Wicket-keeper' : 'Caught by'} (required)</span>
            <SearchSelect options={fielders.xi.map((id) => ({ value: id, label: personName(id) }))} value={chosenFielder} onChange={setFielder} placeholder="Search for a player" ariaLabel="Fielder" />
          </div>
        )}
        {(kind === 'caught' || kind === 'run_out') && (
          <div>
            <span className="label">{kind === 'caught' ? 'Where was it caught?' : 'Where did the throw come from?'} (optional{at ? ` — ${shotRegion(at, false)}` : ''})</span>
            <GroundMap exact picked={at} onPick={setAt} />
          </div>
        )}
        {!kind ? <p className="text-sm text-muted">Pick how the batter got out.</p> : fielderShown && !chosenFielder ? <p className="text-sm text-warn">Pick the fielder above to continue.</p> : null}
        <button className="btn-primary" disabled={!ready} onClick={confirm}>
          Confirm wicket
        </button>
      </div>
    </Sheet>
  )
}

// ---------- where did the boundary go ----------
function ShotSheet({ runs, batter, left, onLeft, onSave, onSkip, onClose }: { runs: number; batter: string; left: boolean; onLeft: (v: boolean) => void; onSave: (shot: [number, number]) => void; onSkip: () => void; onClose: () => void }) {
  const [picked, setPicked] = useState<[number, number] | null>(null)
  const boundary = runs === 4 || runs === 6
  const what = runs === 6 ? 'six' : runs === 4 ? 'four' : runs === 1 ? '1 run' : `${runs} runs`
  return (
    <Sheet title={`${boundary ? what.toUpperCase() : what[0].toUpperCase() + what.slice(1)} — where did it go?`} onClose={onClose}>
      <GroundMap left={left} picked={picked} onPick={setPicked} />
      <p className="mt-1 min-h-[20px] text-center text-sm font-medium">
        {picked ? `To ${shotRegion(picked, left)}` : <span className="text-muted">{boundary ? 'Tap the ground where the ball crossed the rope' : 'Tap where the ball went (optional)'}</span>}
      </p>
      <div className="mt-2 flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{batter} bats left-handed</span>
        <Toggle checked={left} onChange={onLeft} label={`${batter} bats left-handed`} />
      </div>
      <div className="mt-3 flex gap-2">
        {!boundary && (
          <button className="btn-secondary flex-1" onClick={onSkip}>
            Skip
          </button>
        )}
        <button className="btn-primary flex-1" disabled={!picked} onClick={() => picked && onSave(picked)}>
          Save {what}
        </button>
      </div>
    </Sheet>
  )
}

// ---------- correct an earlier ball ----------
function EditBallSheet({ ball, left, allDirections, onSave, onClose }: { ball: BallEvent; left: boolean; allDirections: boolean; onSave: (patch: { bat: number; byes: number; byeType?: 'b' | 'lb'; shot?: [number, number] | null }) => void; onClose: () => void }) {
  const wide = ball.kind === 'wd'
  const [how, setHow] = useState<'bat' | 'b' | 'lb'>(ball.byes > 0 && !wide ? (ball.byeType ?? 'b') : 'bat')
  const [n, setN] = useState(wide ? ball.byes : ball.byes > 0 ? ball.byes : ball.bat)
  const [shot, setShot] = useState<[number, number] | null>(ball.shot ?? null)
  const boundary = !wide && how === 'bat' && (n === 4 || n === 6)
  // 1s, 2s and 3s may carry a direction too (never required).
  const small = !wide && how === 'bat' && n >= 1 && n <= 3 && (allDirections || !!ball.shot)
  return (
    <Sheet title="Correct this ball" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {ball.wicket && <p className="text-sm text-muted">This ball has a wicket ({WICKET_LABELS[ball.wicket.kind]}). To change the wicket itself, undo back to it.</p>}
        {!wide && (
          <Segmented
            options={[
              { value: 'bat', label: 'Off the bat' },
              { value: 'b', label: 'Byes' },
              { value: 'lb', label: 'Leg byes' },
            ]}
            value={how}
            onChange={setHow}
          />
        )}
        <div>
          <span className="label">{wide ? 'Extra runs on the wide' : ball.kind === 'nb' ? 'Runs (on top of the no-ball)' : 'Runs'}</span>
          <ChoiceChips options={[0, 1, 2, 3, 4, 5, 6].map((v) => ({ value: String(v), label: String(v) }))} value={String(n)} onChange={(v) => setN(Number(v))} />
        </div>
        {(boundary || small) && (
          <div>
            <span className="label">Direction ({boundary ? 'required' : 'optional'}){shot ? ` — ${shotRegion(shot, left)}` : ''}</span>
            <GroundMap left={left} picked={shot} onPick={setShot} />
          </div>
        )}
        <button className="btn-primary" disabled={boundary && !shot} onClick={() => onSave(wide ? { bat: 0, byes: n } : how === 'bat' ? { bat: n, byes: 0, shot: boundary || small ? shot : null } : { bat: 0, byes: n, byeType: how, shot: null })}>
          Save
        </button>
        <p className="text-xs text-muted">To turn a ball into a wide or no-ball (or back), use Undo instead.</p>
      </div>
    </Sheet>
  )
}

function RetireSheet({ batters, onRetire, onClose }: { batters: string[]; onRetire: (who: string, out: boolean) => void; onClose: () => void }) {
  const { personName } = useApp()
  const [who, setWho] = useState(batters[0])
  return (
    <Sheet title="Retire a batter" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ChoiceChips options={batters.map((id) => ({ value: id, label: personName(id) }))} value={who} onChange={setWho} />
        <div className="flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => onRetire(who, false)}>
            Retired hurt
          </button>
          <button className="btn-danger flex-1" onClick={() => onRetire(who, true)}>
            Retired out
          </button>
        </div>
        <p className="text-xs text-muted">Retired hurt is not a wicket; the batter can come back later. Retired out counts as a wicket.</p>
      </div>
    </Sheet>
  )
}

function PenaltySheet({ batting, fielding, onAdd, onClose }: { batting: string; fielding: string; onAdd: (runs: number, to: 'batting' | 'fielding') => void; onClose: () => void }) {
  const [runs, setRuns] = useState('5')
  const [to, setTo] = useState<'batting' | 'fielding'>('batting')
  return (
    <Sheet title="Penalty runs" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Runs">
          <NumberInput value={runs} onChange={setRuns} maxLength={2} ariaLabel="Penalty runs" />
        </Field>
        <div>
          <span className="label">Awarded to</span>
          <ChoiceChips
            options={[
              { value: 'batting' as const, label: `${batting} (batting)` },
              { value: 'fielding' as const, label: `${fielding} (fielding)` },
            ]}
            value={to}
            onChange={setTo}
          />
        </div>
        <button className="btn-primary" disabled={!(Number(runs) > 0)} onClick={() => onAdd(Number(runs), to)}>
          Add penalty runs
        </button>
      </div>
    </Sheet>
  )
}

function NumberSheet({ title, hint, initial, onSave, onClose }: { title: string; hint: string; initial: number; onSave: (n: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(String(initial))
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label={title} hint={hint}>
          <NumberInput value={value} onChange={setValue} maxLength={3} ariaLabel={title} autoFocus />
        </Field>
        <button className="btn-primary" disabled={!value} onClick={() => onSave(Number(value))}>
          Save
        </button>
      </div>
    </Sheet>
  )
}
