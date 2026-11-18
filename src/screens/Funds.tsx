// Funds tab (PLAN §16.5, §16.7): each team's fund, every player's balance and
// dues, and the ledger per player. Viewers see the same screen read-only.
import { useEffect, useState } from 'react'
import { PAY_METHODS } from '../components/MatchMoney'
import { Screen } from '../components/Screen'
import { Avatar, ChoiceChips, Confirm, Empty, ErrorNote, Field, NumberInput, Pill, Sheet } from '../components/ui'
import { fmtDayMonth, money, todayISO } from '../lib/dates'
import { addAdjustment, addContribution, addRefund, deleteFundEntry, isGuestIn, lowBalanceThreshold, updateFundEntry } from '../lib/domain'
import { balanceOf, collected, duesOf, duesTotal, pendingDues, teamFund, usedForMatches, type Due } from '../lib/funds'
import { getPref, setPref } from '../lib/session'
import { useApp, useTeam, type TeamData } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'
import { METHOD_LABELS, type FundEntry, type PayMethod, type Team } from '../types'
import { RemindSheet } from './PlayerStatement'

type Filter = 'all' | 'low' | 'dues'

export function Funds() {
  const { teams, isAdmin, people, session, store, personName } = useApp()
  const sheet = useSheet()
  const visible = teams.filter((t) => !t.archived || (isAdmin && getPref('showArchived', false)))
  const [teamId, setTeamId] = useState<string>(() => getPref('fundsTeam', ''))
  const [filter, setFilter] = useState<Filter>('all')
  const current = visible.find((t) => t.id === teamId) ?? visible[0]
  const data = useTeam(current?.id)

  useEffect(() => {
    if (current) setPref('fundsTeam', current.id)
  }, [current])

  if (!current || !store) {
    return (
      <Screen title="Funds">
        <Empty icon="💰" title="No teams yet" text="Team funds appear here once you’re in a team." />
      </Screen>
    )
  }

  const me = session?.personId ?? ''
  const threshold = lowBalanceThreshold(store)
  const { members, matches, funds } = data
  const activeIds = members.filter((m) => m.status === 'active').map((m) => m.personId)
  const leftIds = members.filter((m) => m.status === 'removed').map((m) => m.personId)
  // Guests and people who left are listed only when they have a balance, dues or history.
  const involved = new Set([...funds.map((e) => e.personId), ...matches.filter((m) => m.expense?.status === 'submitted').flatMap((m) => m.expense!.shares.map((s) => s.personId))])
  const guestIds = [...involved].filter((id) => isGuestIn(members, id))
  const known = new Set(people.map((p) => p.id))

  const rowsFor = (ids: string[]) =>
    ids
      .filter((id) => known.has(id))
      .map((id) => ({ id, name: personName(id), balance: balanceOf(funds, id), dues: duesTotal(matches, id) }))
      .filter((r) => (filter === 'low' ? r.balance < threshold : filter === 'dues' ? r.dues > 0 : true))
      // The viewer's own row is pinned to the top.
      .sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name)))

  const sections = [
    { title: 'Players', rows: rowsFor(activeIds) },
    { title: 'Guests', rows: rowsFor(guestIds) },
    { title: 'Left team', rows: rowsFor(leftIds.filter((id) => involved.has(id))) },
  ].filter((s) => s.rows.length > 0)

  const selectedId = sheet.name === 'fund' ? sheet.arg : null
  const owing = [...known].filter((id) => duesOf(matches, id).length > 0)

  return (
    <Screen title="Funds">
      <div className="flex flex-col gap-4 p-4">
        {visible.length > 4 ? (
          <select className="input" value={current.id} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
            {visible.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          visible.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {visible.map((t) => (
                <button key={t.id} className={`${t.id === current.id ? 'chip-on' : 'chip'} min-h-[36px] px-3`} aria-pressed={t.id === current.id} onClick={() => setTeamId(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          )
        )}

        {!data.ready ? (
          <p className="p-10 text-center text-sm text-muted">Loading…</p>
        ) : (
          <>
            <div className="card overflow-hidden">
              <div className="h-1.5" style={{ background: current.color }} />
              <div className="p-4">
                <div className="text-xs text-muted">{current.name} · Team fund</div>
                <div className="text-3xl font-bold">{money(teamFund(funds))}</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <div className="text-muted">Collected</div>
                    <div className="text-sm font-semibold">{money(collected(funds))}</div>
                  </div>
                  <div>
                    <div className="text-muted">Used for matches</div>
                    <div className="text-sm font-semibold">{money(usedForMatches(funds))}</div>
                  </div>
                  <div>
                    <div className="text-muted">Pending dues</div>
                    <div className={`text-sm font-semibold ${pendingDues(matches) > 0 ? 'text-warn' : ''}`}>{money(pendingDues(matches))}</div>
                  </div>
                </div>
              </div>
            </div>

            {isAdmin && activeIds.length > 0 && (
              <button className="btn-primary" onClick={() => sheet.open('pick')}>
                + Add contribution
              </button>
            )}

            <button className="btn-secondary" onClick={() => navigate(`/teams/${current.id}/year`)}>
              📅 Year summary
            </button>

            {isAdmin && owing.length > 0 && (
              <button className="btn-secondary" onClick={() => sheet.open('remindall')}>
                🔔 Remind {owing.length} player{owing.length === 1 ? '' : 's'} with dues
              </button>
            )}

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['all', 'All'],
                  ['low', `Low balance (< ${money(threshold)})`],
                  ['dues', 'Has dues'],
                ] as [Filter, string][]
              ).map(([v, label]) => (
                <button key={v} className={`${filter === v ? 'chip-on' : 'chip'} min-h-[36px] px-3`} aria-pressed={filter === v} onClick={() => setFilter(v)}>
                  {label}
                </button>
              ))}
            </div>

            {sections.length === 0 && <Empty icon="👥" title={filter === 'all' ? 'No players yet' : 'Nobody matches this filter'} />}

            {sections.map((sec) => (
              <section key={sec.title}>
                <h2 className="section-title">{sec.title}</h2>
                <div className="card divide-y divide-line overflow-hidden">
                  {sec.rows.map((r) => (
                    <button key={r.id} className={`row active:bg-alt ${r.id === me ? 'bg-alt' : ''}`} onClick={() => sheet.open('fund', r.id)}>
                      <Avatar name={r.name} personId={r.id} color={current.color} size={36} />
                      <span className="min-w-0 flex-1 truncate">
                        {r.name}
                        {r.id === me && <span className="text-muted"> (you)</span>}
                      </span>
                      {r.dues > 0 && <Pill tone="warn">{money(r.dues)} due</Pill>}
                      <span className={`font-semibold ${r.balance > 0 ? 'text-ok' : 'text-muted'}`}>{money(r.balance)}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      {sheet.name === 'pick' && isAdmin && (
        <Sheet title="Add contribution — pick a player" onClose={sheet.close}>
          <div className="card divide-y divide-line overflow-hidden">
            {rowsFor([...activeIds, ...guestIds]).map((r) => (
              <button key={r.id} className="row active:bg-alt" onClick={() => sheet.replaceWith(`/funds?sheet=fund&arg=${r.id}&mode=contribution`)}>
                <Avatar name={r.name} personId={r.id} color={current.color} size={32} />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="text-sm text-muted">{money(r.balance)}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {sheet.name === 'remindall' && isAdmin && <RemindSheet teamId={current.id} teamName={current.name} personIds={owing} onClose={sheet.close} />}

      {selectedId && known.has(selectedId) && data.ready && <PlayerFundSheet team={current} personId={selectedId} data={data} onClose={sheet.close} />}
    </Screen>
  )
}

type Mode = 'view' | 'contribution' | 'refund' | 'adjustment'

function entryLabel(e: FundEntry, opponent?: string): string {
  if (e.type === 'match_deduction') return `vs ${opponent ?? 'match'}`
  const what = e.type === 'contribution' ? 'contribution' : e.type === 'refund' ? 'refund' : 'adjustment'
  return [what, e.method ? METHOD_LABELS[e.method] : null].filter(Boolean).join(' · ')
}

function PlayerFundSheet({ team, personId, data, onClose }: { team: Team; personId: string; data: TeamData; onClose: () => void }) {
  const { store, isAdmin, personName, toast } = useApp()
  const startMode = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('mode') === 'contribution' ? 'contribution' : 'view'
  const [mode, setMode] = useState<Mode>(isAdmin ? startMode : 'view')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [method, setMethod] = useState<PayMethod>('upi')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [askDues, setAskDues] = useState<Due[] | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<FundEntry | null>(null)
  const [deleting, setDeleting] = useState<FundEntry | null>(null)

  const name = personName(personId)
  const { funds, matches, members } = data
  const balance = balanceOf(funds, personId)
  const dues = duesOf(matches, personId)
  const history = funds.filter((e) => e.personId === personId).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))
  const matchOf = (id?: string) => matches.find((m) => m.id === id)

  function reset() {
    setMode('view')
    setAmount('')
    setNote('')
    setError(null)
    setEditing(null)
    setDate(todayISO())
  }

  function fail(e: unknown) {
    setError((e as Error).message)
  }

  function saveContribution(settleIds: string[]) {
    try {
      const out = addContribution(store!, team.id, { personId, amount: Number(amount), date, method, note }, settleIds)
      toast(out.settled ? `Contribution added · ${out.settled} due${out.settled === 1 ? '' : 's'} settled` : 'Contribution added')
      setAskDues(null)
      reset()
    } catch (e) {
      setAskDues(null)
      fail(e)
    }
  }

  function submit() {
    setError(null)
    const n = Number(amount)
    try {
      if (editing) {
        updateFundEntry(store!, team.id, editing.id, { amount: n, date, method, note })
        toast('Entry updated')
        return reset()
      }
      if (mode === 'contribution') {
        if (!Number.isInteger(n) || n <= 0) throw new Error('Enter an amount in whole rupees.')
        // If they owe for matches, ask whether this money should pay those off.
        if (dues.length > 0) {
          setTicked(new Set(dues.map((d) => d.match.id)))
          return setAskDues(dues)
        }
        return saveContribution([])
      }
      if (mode === 'refund') {
        addRefund(store!, team.id, { personId, amount: n, date, method, note })
        toast('Refund recorded')
      } else if (mode === 'adjustment') {
        addAdjustment(store!, team.id, { personId, amount: n, date, note })
        toast('Adjustment recorded')
      }
      reset()
    } catch (e) {
      fail(e)
    }
  }

  function startEdit(e: FundEntry) {
    setEditing(e)
    setMode(e.type as Mode)
    setAmount(String(e.amount))
    setDate(e.date)
    setMethod(e.method ?? 'upi')
    setNote(e.note ?? '')
    setError(null)
  }

  // How far the new balance stretches across the ticked dues, oldest first.
  const affordable = (() => {
    let left = balance + (Number(amount) || 0)
    const ok = new Set<string>()
    for (const d of askDues ?? []) {
      if (!ticked.has(d.match.id)) continue
      if (left < d.pending) break
      left -= d.pending
      ok.add(d.match.id)
    }
    return ok
  })()

  const titles: Record<Mode, string> = { view: name, contribution: 'Add contribution', refund: 'Refund / withdraw', adjustment: 'Adjustment' }

  return (
    <Sheet title={editing ? 'Edit entry' : titles[mode]} onClose={onClose}>
      {mode === 'view' ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={name} personId={personId} color={team.color} size={48} />
            <div>
              <div className="flex items-center gap-2 text-xs text-muted">
                Balance in {team.shortName}
                {isGuestIn(members, personId) && <Pill>Guest</Pill>}
              </div>
              <div className={`text-2xl font-bold ${balance > 0 ? 'text-ok' : ''}`}>{money(balance)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <div className="card py-2">
              <div className="text-muted">Total contributed</div>
              <div className="text-sm font-semibold">{money(collected(funds, personId))}</div>
            </div>
            <div className="card py-2">
              <div className="text-muted">Used for matches</div>
              <div className="text-sm font-semibold">{money(usedForMatches(funds, personId))}</div>
            </div>
          </div>

          {dues.length > 0 && (
            <div className="rounded-xl bg-warn/15 px-3 py-2 text-sm text-warn">
              {dues.map((d) => (
                <button key={d.match.id} className="block w-full text-left" onClick={() => navigate(`/teams/${team.id}/matches/${d.match.id}`)}>
                  Owes {money(d.pending)} for vs {d.match.opponent} ({fmtDayMonth(d.match.date)}) ›
                </button>
              ))}
            </div>
          )}

          <button className="btn-secondary" onClick={() => navigate(`/teams/${team.id}/statement/${personId}`)}>
            🧾 Full statement{dues.length > 0 && isAdmin ? ' and reminder' : ''}
          </button>

          {isAdmin && (
            <div className="grid grid-cols-3 gap-2">
              <button className="btn-primary px-2" onClick={() => setMode('contribution')}>
                + Add
              </button>
              <button className="btn-secondary px-2" disabled={balance <= 0} onClick={() => setMode('refund')}>
                Refund
              </button>
              <button className="btn-secondary px-2" onClick={() => setMode('adjustment')}>
                Adjust
              </button>
            </div>
          )}
          <ErrorNote>{error}</ErrorNote>

          <div>
            <h3 className="section-title">History</h3>
            {history.length === 0 ? (
              <p className="card px-4 py-4 text-center text-sm text-muted">No fund activity yet.</p>
            ) : (
              <div className="card divide-y divide-line overflow-hidden">
                {history.map((e) => {
                  const m = matchOf(e.matchId)
                  const delta = e.type === 'contribution' ? e.amount : e.type === 'adjustment' ? e.amount : -e.amount
                  const editable = isAdmin && e.type !== 'match_deduction'
                  return (
                    <div key={e.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                      <button className="min-w-0 flex-1 text-left" disabled={!m} onClick={() => m && navigate(`/teams/${team.id}/matches/${m.id}`)}>
                        <span className={`font-semibold ${delta >= 0 ? 'text-ok' : 'text-ink'}`}>{delta >= 0 ? `+${money(delta)}` : money(delta)}</span>{' '}
                        <span>{entryLabel(e, m?.opponent)}</span>
                        <span className="block truncate text-xs text-muted">
                          {fmtDayMonth(e.date)}
                          {e.note && ` · ${e.note}`}
                        </span>
                      </button>
                      {editable && (
                        <>
                          <button className="btn-ghost min-h-[40px]" onClick={() => startEdit(e)}>
                            Edit
                          </button>
                          <button className="flex h-10 w-8 items-center justify-center text-bad" aria-label="Delete entry" onClick={() => setDeleting(e)}>
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <p className="text-sm text-muted">
            {name} · balance {money(balance)}
          </p>
          <Field label={mode === 'adjustment' ? 'Amount (₹) — use a minus sign to reduce the balance' : 'Amount (₹)'} hint={mode === 'refund' ? `Up to ${money(balance)}.` : undefined}>
            <NumberInput value={amount} onChange={setAmount} maxLength={7} autoFocus allowNegative={mode === 'adjustment'} placeholder="0" ariaLabel="Amount" />
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {mode !== 'adjustment' && (
            <div>
              <span className="label">Method</span>
              <ChoiceChips options={PAY_METHODS} value={method} onChange={setMethod} />
            </div>
          )}
          <Field label={mode === 'adjustment' ? 'Note (required)' : 'Note (optional)'}>
            <input className="input" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={reset}>
              Back
            </button>
            <button className="btn-primary flex-1" disabled={!amount || amount === '-' || !date}>
              Save
            </button>
          </div>
        </form>
      )}

      {askDues && (
        <Confirm
          title="Use this to settle dues?"
          message={`${name} owes for ${askDues.length === 1 ? 'a match' : `${askDues.length} matches`}. Ticked dues are paid from this contribution; the rest stays in the balance.`}
          confirmLabel={affordable.size > 0 ? 'Yes, settle' : 'Save'}
          cancelLabel="No, keep in balance"
          onCancel={() => saveContribution([])}
          onConfirm={() => saveContribution([...affordable])}
        >
          <div className="mt-3 flex flex-col gap-1">
            {askDues.map((d) => (
              <label key={d.match.id} className="flex min-h-[44px] items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[rgb(155,28,31)]"
                  checked={ticked.has(d.match.id)}
                  onChange={(e) => {
                    const next = new Set(ticked)
                    if (e.target.checked) next.add(d.match.id)
                    else next.delete(d.match.id)
                    setTicked(next)
                  }}
                />
                <span className="flex-1">
                  {money(d.pending)} · vs {d.match.opponent} ({fmtDayMonth(d.match.date)})
                  {ticked.has(d.match.id) && !affordable.has(d.match.id) && <span className="block text-xs text-warn">Not enough balance for this one</span>}
                </span>
              </label>
            ))}
          </div>
        </Confirm>
      )}

      {deleting && (
        <Confirm
          title="Delete this entry?"
          message={`${money(deleting.amount)} ${deleting.type} on ${fmtDayMonth(deleting.date)}.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            try {
              deleteFundEntry(store!, team.id, deleting.id)
              toast('Entry deleted')
            } catch (e) {
              fail(e)
            }
            setDeleting(null)
          }}
        />
      )}
    </Sheet>
  )
}
