// Split expenses (PLAN §16.3). Works on a local copy that is auto-saved as a
// draft, so leaving and coming back keeps everything. Submitting deducts from
// each player's fund first; what a balance can't cover stays pending.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Screen } from '../components/Screen'
import { Avatar, Confirm, Empty, ErrorNote, NumberInput, Pill, Sheet, Toggle } from '../components/ui'
import { fmtDayMonth, money } from '../lib/dates'
import { availableFor, isGuestIn, newDraft, saveDraft, submitExpenses } from '../lib/domain'
import { carrySettlements, computeSplit, participantsOf, validateSplit } from '../lib/split'
import { P } from '../lib/paths'
import { useApp, useFile, useTeam } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'
import type { ExpenseCategoriesFile, ExpenseLine } from '../types'

const shortCat = (name: string) => (name.length > 9 ? `${name.slice(0, 8)}…` : name)

export function SplitExpenses({ teamId, matchId }: { teamId: string; matchId: string }) {
  const { store, canManage, personName, teams, toast } = useApp()
  const isAdmin = canManage(teamId)
  const catFile = useFile<ExpenseCategoriesFile>(P.categories(teamId))
  const catsReady = !!store?.has(P.categories(teamId))
  const categories = useMemo(() => catFile?.categories ?? [], [catFile])
  const sheet = useSheet()
  const data = useTeam(teamId)
  const match = data.matches.find((m) => m.id === matchId)
  const team = teams.find((t) => t.id === teamId)
  const base = `/teams/${teamId}/matches/${matchId}`

  const [lines, setLines] = useState<ExpenseLine[] | null>(null)
  const [payerIds, setPayerIds] = useState<string[]>([])
  const [onlyDues, setOnlyDues] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = useRef(false)
  const [picked, setPicked] = useState<{ categoryId: string; personId: string } | null>(null)
  const [amountText, setAmountText] = useState('')

  // Start from the saved draft / submitted split, or a fresh draft from the categories.
  useEffect(() => {
    if (lines !== null || !match || !data.ready || (!match.expense && !catsReady)) return
    const start = match.expense ?? newDraft(match, categories)
    setLines(start.lines)
    setPayerIds(start.payerIds.filter((id) => match.squad.includes(id)))
  }, [lines, match, data.ready, categories, catsReady])

  const submitted = match?.expense?.status === 'submitted'

  // Auto-save while it is still a draft.
  useEffect(() => {
    if (!dirty.current || !store || !lines || submitted) return
    dirty.current = false
    saveDraft(store, teamId, matchId, { lines, payerIds })
  }, [lines, payerIds, store, teamId, matchId, submitted])

  const available = useMemo(
    () => (store && match ? availableFor(store, teamId, matchId, match.squad) : {}),
    // balances change when the funds file does
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, teamId, matchId, match?.squad.join(','), data.funds],
  )

  if (!match || !team || !store || !isAdmin || !lines) {
    return (
      <Screen title="Split expenses" back={base}>
        {(data.ready && !match) || !isAdmin ? <Empty icon="🤷" title="Match not found" /> : <p className="p-10 text-center text-sm text-muted">Loading…</p>}
      </Screen>
    )
  }
  if (match.squad.length === 0) {
    return (
      <Screen title="Split expenses" back={base}>
        <Empty
          icon="👥"
          title="Pick the squad first"
          text="Expenses are split among the players in the squad."
          action={
            <button className="btn-primary" onClick={() => navigate(`${base}/squad`)}>
              Pick squad
            </button>
          }
        />
      </Screen>
    )
  }

  const change = (nextLines: ExpenseLine[], nextPayers = payerIds) => {
    dirty.current = true
    setLines(nextLines)
    setPayerIds(nextPayers)
  }

  const live = lines.filter((l) => l.total > 0)
  const res = computeSplit({ lines: live, payerIds, available })
  const errors = validateSplit(lines, payerIds)
  const previous = submitted ? match.expense!.shares : []
  const { shares: carried, reopened } = carrySettlements(res.shares, previous)
  const toCollect = carried.filter((s) => !s.settled).reduce((sum, s) => sum + s.pending, 0)
  const owing = carried.filter((s) => !s.settled).length
  const paidFromFunds = res.shares.filter((s) => s.fromFunds > 0).length

  const squad = [...match.squad].sort((a, b) => personName(a).localeCompare(personName(b)))
  const shareOf = (id: string) => res.shares.find((s) => s.personId === id)
  const shown = onlyDues ? squad.filter((id) => (shareOf(id)?.pending ?? 0) > 0) : squad
  const addable = categories.filter((c) => !c.archived && !lines.some((l) => l.categoryId === c.id)).sort((a, b) => a.order - b.order)

  function setTotal(categoryId: string, value: string) {
    change(lines!.map((l) => (l.categoryId === categoryId ? { ...l, total: Number(value) || 0 } : l)))
  }
  function togglePayer(id: string) {
    change(lines!, payerIds.includes(id) ? payerIds.filter((p) => p !== id) : [...payerIds, id])
  }
  function editLine(categoryId: string, fn: (l: ExpenseLine) => ExpenseLine) {
    change(lines!.map((l) => (l.categoryId === categoryId ? fn(l) : l)))
  }
  const withoutFixed = (l: ExpenseLine, id: string) => {
    if (!l.fixed) return l.fixed
    const { [id]: _gone, ...keep } = l.fixed
    return Object.keys(keep).length ? keep : undefined
  }
  /** Take the person out of this expense; the others share the rest. */
  function removeFrom(categoryId: string, id: string) {
    editLine(categoryId, (l) => ({ ...l, excludedPersonIds: [...l.excludedPersonIds, id], fixed: withoutFixed(l, id) }))
  }
  function addBack(categoryId: string, id: string) {
    editLine(categoryId, (l) => ({ ...l, excludedPersonIds: l.excludedPersonIds.filter((p) => p !== id) }))
  }
  /** This person pays exactly this much; the others share what is left. */
  function setOwnAmount(categoryId: string, id: string, amount: number) {
    editLine(categoryId, (l) => ({ ...l, fixed: { ...l.fixed, [id]: amount } }))
  }
  function resetOwnAmount(categoryId: string, id: string) {
    editLine(categoryId, (l) => ({ ...l, fixed: withoutFixed(l, id) }))
  }

  function submit(complete: boolean) {
    setConfirm(false)
    try {
      const out = submitExpenses(store!, teamId, matchId, { lines: lines!, payerIds }, complete)
      toast(out.completed ? 'Expenses submitted — match completed 🎉' : 'Expenses submitted')
      navigate(base, { replace: true })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Screen
      title={submitted ? 'Edit expenses' : 'Split expenses'}
      back={base}
      footer={
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            Total <strong className="text-ink">{money(res.total)}</strong> · From funds <strong className="text-ok">{money(res.fromFunds)}</strong> · To collect{' '}
            <strong className={toCollect > 0 ? 'text-warn' : 'text-ink'}>{money(toCollect)}</strong>
            {res.roundingExtra > 0 && ` · Includes ${money(res.roundingExtra)} rounding`}
          </p>
          <button
            className="btn-primary w-full"
            disabled={errors.length > 0}
            onClick={() => {
              setError(null)
              setConfirm(true)
            }}
          >
            {submitted ? 'Re-submit expenses' : 'Submit expenses'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-muted">
          vs {match.opponent} · {fmtDayMonth(match.date)}
          {!submitted && ' · saved automatically as a draft'}
        </p>

        <section>
          <h2 className="section-title">Expenses</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {lines.map((l) => {
              const n = participantsOf(l, payerIds).length
              const split = res.perLine[l.categoryId]
              return (
                <div key={l.categoryId} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {l.categoryName}
                      {l.mode === 'mandatory' && <span className="text-bad" aria-label="required"> *</span>}
                    </span>
                    <span className="block text-xs text-muted">{split ? `÷ ${split.participants} player${split.participants === 1 ? '' : 's'} · ${money(split.perHead)} each${Object.keys(l.fixed ?? {}).length ? ` · ${Object.keys(l.fixed ?? {}).length} set separately` : ''}` :n === 0 && l.total > 0 ? 'Nobody is sharing this' : '—'}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-muted">₹</span>
                    <NumberInput className="input w-24 text-right" value={l.total ? String(l.total) : ''} onChange={(v) => setTotal(l.categoryId, v)} maxLength={7} placeholder="0" ariaLabel={`${l.categoryName} amount`} />
                  </span>
                  {l.mode !== 'mandatory' ? (
                    <button className="flex h-11 w-9 items-center justify-center text-lg text-muted" aria-label={`Remove ${l.categoryName}`} onClick={() => change(lines.filter((x) => x.categoryId !== l.categoryId))}>
                      ×
                    </button>
                  ) : (
                    <span className="w-9" />
                  )}
                </div>
              )
            })}
            <div className="flex items-center justify-between px-4 py-3">
              {addable.length > 0 ? (
                <button className="font-medium text-accent" onClick={() => sheet.open('addcat')}>
                  + Add category
                </button>
              ) : (
                <span />
              )}
              <span className="font-semibold">Total {money(res.total)}</span>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h2 className="section-title">
              Members ({payerIds.length} of {squad.length} paying)
            </h2>
            <button className={`${onlyDues ? 'chip-on' : 'chip'} mb-2 min-h-[32px] px-3`} aria-pressed={onlyDues} onClick={() => setOnlyDues((v) => !v)}>
              Has dues
            </button>
          </div>
          <div className="card divide-y divide-line overflow-hidden">
            {shown.map((id) => {
              const pays = payerIds.includes(id)
              const share = shareOf(id)
              const funds = available[id] ?? 0
              return (
                <div key={id} className={`px-4 py-3 ${pays ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-3">
                    <Avatar name={personName(id)} personId={id} color={team.color} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{personName(id)}</span>
                        {isGuestIn(data.members, id) && <Pill>Guest</Pill>}
                      </span>
                      <span className={`block text-xs ${funds > 0 ? 'text-ok' : 'text-muted'}`}>Funds: {money(funds)}</span>
                    </span>
                    {pays && share && <strong className="text-base">{money(share.total)}</strong>}
                    <span className="flex flex-col items-center gap-0.5">
                      <Toggle label={`${personName(id)} pays`} checked={pays} onChange={() => togglePayer(id)} />
                      <span className="text-[10px] text-muted">{pays ? 'Pays' : 'Not paying'}</span>
                    </span>
                  </div>
                  {pays && share && (
                    <>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {live.map((l) => {
                          const out = l.excludedPersonIds.includes(id)
                          const own = l.fixed?.[id] !== undefined
                          return (
                            <button
                              key={l.categoryId}
                              className={`min-h-[32px] rounded-full border px-2.5 text-xs ${out ? 'border-line text-muted line-through' : own ? 'border-accent bg-chip' : 'border-chip-line bg-chip'}`}
                              aria-label={`${l.categoryName} for ${personName(id)}: ${out ? 'removed' : own ? 'set separately' : 'shared equally'}. Tap for options`}
                              onClick={() => {
                                setAmountText(String(share.byCategory[l.categoryId] ?? l.fixed?.[id] ?? ''))
                                setPicked({ categoryId: l.categoryId, personId: id })
                              }}
                            >
                              {shortCat(l.categoryName)} {out ? '' : money(share.byCategory[l.categoryId] ?? 0)}
                              {own && !out ? ' ✎' : ''}
                            </button>
                          )
                        })}
                      </div>
                      <p className={`mt-1.5 text-xs font-medium ${share.pending === 0 ? 'text-ok' : share.fromFunds > 0 ? 'text-warn' : 'text-bad'}`}>
                        {share.total === 0
                          ? 'Nothing to pay'
                          : share.pending === 0
                            ? `${money(share.fromFunds)} from funds`
                            : share.fromFunds > 0
                              ? `${money(share.fromFunds)} from funds · ${money(share.pending)} due`
                              : `${money(share.pending)} due`}
                      </p>
                    </>
                  )}
                </div>
              )
            })}
            {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">Nobody has dues.</p>}
          </div>
        </section>

        {errors.length > 0 && <ErrorNote>{errors[0]}</ErrorNote>}
        <ErrorNote>{error}</ErrorNote>
      </div>

      {picked && (() => {
        const l = lines.find((x) => x.categoryId === picked.categoryId)
        if (!l) return null
        const id = picked.personId
        const out = l.excludedPersonIds.includes(id)
        const own = l.fixed?.[id] !== undefined
        const close = () => setPicked(null)
        const amount = Number(amountText)
        const valid = amountText.trim() !== '' && Number.isInteger(amount) && amount >= 0 && amount <= l.total
        return (
          <Sheet title={`${l.categoryName} · ${personName(id)}`} onClose={close}>
            {out ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted">{personName(id)} is not sharing {l.categoryName}.</p>
                <button className="btn-primary" onClick={() => { addBack(l.categoryId, id); close() }}>
                  Add back to this expense
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <span className="label">Update — what {personName(id)} pays for {l.categoryName}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted">₹</span>
                    <NumberInput className="input flex-1" value={amountText} onChange={setAmountText} maxLength={7} placeholder="0" ariaLabel="Amount for this player" />
                  </div>
                  <p className="mt-1 text-xs text-muted">The rest of the {money(l.total)} is shared by everyone else in this expense.</p>
                  <div className="mt-3 flex gap-2">
                    <button className="btn-primary flex-1" disabled={!valid} onClick={() => { setOwnAmount(l.categoryId, id, amount); close() }}>
                      Save amount
                    </button>
                    {own && (
                      <button className="btn-secondary" onClick={() => { resetOwnAmount(l.categoryId, id); close() }}>
                        Share equally
                      </button>
                    )}
                  </div>
                </div>
                <hr className="border-line" />
                <div>
                  <button className="btn-secondary w-full text-bad" onClick={() => { removeFrom(l.categoryId, id); close() }}>
                    Remove {personName(id)} from this expense
                  </button>
                  <p className="mt-1 text-xs text-muted">Their part is shared by the others.</p>
                </div>
              </div>
            )}
          </Sheet>
        )
      })()}

      {sheet.name === 'addcat' && (
        <Sheet title="Add category" onClose={sheet.close}>
          <div className="card divide-y divide-line overflow-hidden">
            {addable.map((c) => (
              <button
                key={c.id}
                className="row active:bg-alt"
                onClick={() => {
                  change([...lines, { categoryId: c.id, categoryName: c.name, mode: c.mode, total: c.defaultAmount ?? 0, excludedPersonIds: [] }])
                  sheet.close()
                }}
              >
                <span className="flex-1">{c.name}</span>
                {c.defaultAmount ? <span className="text-muted">{money(c.defaultAmount)}</span> : null}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Manage categories from the team’s menu → Expense categories.</p>
        </Sheet>
      )}

      {confirm && (
        <Confirm
          title={submitted ? 'Re-submit expenses?' : 'Submit expenses?'}
          message={
            <>
              <p>
                {res.fromFunds > 0 ? `${money(res.fromFunds)} will be deducted from ${paidFromFunds} player${paidFromFunds === 1 ? '’s' : 's’'} funds. ` : 'Nothing will be deducted from funds. '}
                {owing > 0 ? `${owing} player${owing === 1 ? ' owes' : 's owe'} ${money(toCollect)} in total.` : 'Nobody owes anything.'}
              </p>
              {reopened.map((r) => (
                <p key={r.personId} className="mt-2 text-warn">
                  {personName(r.personId)}’s due changes from {money(r.was)} to {money(r.now)} — they’ll need settling again.
                </p>
              ))}
            </>
          }
          confirmLabel="Submit"
          onCancel={() => setConfirm(false)}
          onConfirm={() => submit(false)}
        >
          {owing === 0 && (
            <button className="btn-secondary mt-4 w-full" onClick={() => submit(true)}>
              Submit &amp; complete match
            </button>
          )}
        </Confirm>
      )}
    </Screen>
  )
}
