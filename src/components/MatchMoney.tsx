// The money part of match detail (PLAN §16.4, §16.7): draft notice, expense
// summary, settlement, complete / reopen. Viewers see everything read-only.
import { useState } from 'react'
import { fmtDayMonth, money, todayISO } from '../lib/dates'
import { completeMatch, isGuestIn, reopenMatch, settleShare, unsettleShare } from '../lib/domain'
import { useApp, type TeamData } from '../state/AppContext'
import { navigate, useSheet } from '../state/router'
import { METHOD_LABELS, type Match, type PayMethod, type PlayerShare, type Team } from '../types'
import { Avatar, ChoiceChips, Confirm, ErrorNote, Field, Pill, Sheet } from './ui'

export const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'other', label: 'Other' },
]

/** "Paid from funds ✓ ₹383" · "₹200 from funds + ₹183 UPI · 22 Nov" */
export function describeSettled(s: PlayerShare): string {
  if (s.total === 0) return 'Nothing to pay'
  if (s.pending === 0) return `Paid from funds ✓ ${money(s.fromFunds)}`
  const how = `${money(s.pending)} ${METHOD_LABELS[s.settledMethod ?? 'other']}${s.settledAt ? ` · ${fmtDayMonth(s.settledAt.slice(0, 10))}` : ''}`
  return s.fromFunds > 0 ? `${money(s.fromFunds)} from funds + ${how}` : how
}

export function MatchMoney({ team, match, data }: { team: Team; match: Match; data: TeamData }) {
  const { canManage, store, session, personName, toast } = useApp()
  const isAdmin = canManage(team.id)
  const sheet = useSheet()
  const [confirm, setConfirm] = useState<'reopen' | 'complete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const base = `/teams/${team.id}/matches/${match.id}`
  const me = session?.personId ?? ''
  const exp = match.expense

  function run(fn: () => void) {
    setError(null)
    try {
      fn()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const reopenUi = isAdmin && match.lifecycle === 'completed' && (
    <button className="btn-secondary w-full" onClick={() => setConfirm('reopen')}>
      Reopen match
    </button>
  )
  const reopenConfirm = confirm === 'reopen' && (
    <Confirm
      title="Reopen this match?"
      message={match.noExpenseSplit ? 'It goes back to “awaiting completion” so you can split expenses.' : 'It goes back to “settlement pending” so expenses and settlements can be edited.'}
      confirmLabel="Reopen"
      onCancel={() => setConfirm(null)}
      onConfirm={() => {
        setConfirm(null)
        run(() => reopenMatch(store!, team.id, match.id))
      }}
    />
  )

  if (match.cancelled) return null

  if (!exp) {
    if (match.lifecycle !== 'completed') return null
    return (
      <section className="flex flex-col gap-2">
        <div className="card px-4 py-3 text-sm text-muted">Completed with no expense split.</div>
        {reopenUi}
        <ErrorNote>{error}</ErrorNote>
        {reopenConfirm}
      </section>
    )
  }

  if (exp.status === 'draft') {
    if (!isAdmin) return null
    return (
      <div className="card flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm">
          <strong>Expense split in progress</strong>
          <span className="block text-xs text-muted">Saved as a draft — nothing is deducted yet.</span>
        </span>
        <button className="btn-secondary min-h-[40px]" onClick={() => navigate(`${base}/expenses`)}>
          Continue
        </button>
      </div>
    )
  }

  const shares = [...exp.shares].sort((a, b) => personName(a.personId).localeCompare(personName(b.personId)))
  const pending = shares.filter((s) => !s.settled)
  const settled = shares.filter((s) => s.settled)
  const notPaying = match.squad.filter((id) => !exp.payerIds.includes(id))
  const total = exp.lines.reduce((sum, l) => sum + l.total, 0)
  const settling = match.lifecycle === 'settling'
  const mine = shares.find((s) => s.personId === me)
  const target = sheet.name === 'settle' ? shares.find((s) => s.personId === sheet.arg) : undefined

  return (
    <section className="flex flex-col gap-3">
      <h2 className="section-title !pb-0">Expenses</h2>

      {!isAdmin && mine && !mine.settled && mine.pending > 0 && (
        <p className="rounded-xl bg-warn/15 px-3 py-2 text-sm font-medium text-warn">You owe {money(mine.pending)} — pay the admin</p>
      )}

      <div className="card overflow-hidden">
        <div className="divide-y divide-line">
          {exp.lines.map((l) => {
            const n = exp.payerIds.filter((id) => !l.excludedPersonIds.includes(id)).length
            return (
              <div key={l.categoryId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  {l.categoryName}
                  <span className="block text-xs text-muted">
                    ÷ {n} · {money(Math.ceil(l.total / Math.max(1, n)))} each
                  </span>
                </span>
                <span className="font-medium">{money(l.total)}</span>
              </div>
            )
          })}
          <div className="flex items-center justify-between px-4 py-2.5 font-semibold">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
        </div>
        {exp.roundingExtra > 0 && <p className="border-t border-line px-4 py-2 text-xs text-muted">Shares include {money(exp.roundingExtra)} rounding (each share is rounded up to a whole rupee).</p>}
      </div>

      {settling && (
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {settled.length} of {shares.length} settled
            </span>
            {pending.length === 0 && <span className="text-ok">All settled 🎉</span>}
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-alt" role="progressbar" aria-valuenow={settled.length} aria-valuemin={0} aria-valuemax={shares.length}>
            <div className="h-full bg-ok" style={{ width: `${(settled.length / Math.max(1, shares.length)) * 100}%` }} />
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <h3 className="section-title">Pending</h3>
          <div className="card divide-y divide-line overflow-hidden">
            {pending.map((s) => (
              <div key={s.personId} className={`flex items-center gap-3 px-4 py-2.5 ${s.personId === me ? 'bg-alt' : ''}`}>
                <Avatar name={personName(s.personId)} personId={s.personId} color={team.color} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{personName(s.personId)}</span>
                    {isGuestIn(data.members, s.personId) && <Pill>Guest</Pill>}
                  </span>
                  <span className="block text-xs text-bad">
                    {money(s.pending)} due
                    <span className="text-muted">
                      {' '}
                      · share {money(s.total)}
                      {s.fromFunds > 0 && ` · ${money(s.fromFunds)} from funds`}
                    </span>
                  </span>
                </span>
                {isAdmin && settling && (
                  <button className="btn-secondary min-h-[40px] px-3" onClick={() => sheet.open('settle', s.personId)}>
                    Mark settled
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {settled.length > 0 && (
        <div>
          <h3 className="section-title">Settled</h3>
          <div className="card divide-y divide-line overflow-hidden">
            {settled.map((s) => {
              const manual = s.pending > 0 && s.settledMethod !== 'funds'
              return (
                <div key={s.personId} className={`flex items-center gap-3 px-4 py-2.5 ${s.personId === me ? 'bg-alt' : ''}`}>
                  <Avatar name={personName(s.personId)} personId={s.personId} color={team.color} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{personName(s.personId)}</span>
                      {isGuestIn(data.members, s.personId) && <Pill>Guest</Pill>}
                    </span>
                    <span className="block text-xs text-ok">{describeSettled(s)}</span>
                    {s.settledNote && <span className="block text-xs text-muted">{s.settledNote}</span>}
                  </span>
                  <span className="text-sm font-medium">{money(s.total)}</span>
                  {isAdmin && settling && manual && (
                    <button className="btn-ghost min-h-[40px]" onClick={() => run(() => unsettleShare(store!, team.id, match.id, s.personId))}>
                      Undo
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {notPaying.length > 0 && <p className="px-1 text-xs text-muted">Not paying: {notPaying.map(personName).join(', ')}</p>}

      <ErrorNote>{error}</ErrorNote>

      {isAdmin && settling && (
        <div className="flex flex-col gap-2">
          <button className="btn-primary w-full" disabled={pending.length > 0} onClick={() => setConfirm('complete')}>
            Complete match
          </button>
          {pending.length > 0 && (
            <p className="text-center text-xs text-muted">
              {pending.length} player{pending.length === 1 ? '' : 's'} still to settle
            </p>
          )}
          <button className="btn-secondary w-full" onClick={() => navigate(`${base}/expenses`)}>
            Edit expenses
          </button>
        </div>
      )}
      {reopenUi}

      {target && (
        <SettleSheet
          name={personName(target.personId)}
          amount={target.pending}
          onClose={sheet.close}
          onSave={(how) => {
            const last = pending.length === 1
            run(() => settleShare(store!, team.id, match.id, target.personId, how))
            sheet.close()
            // Settling the last one offers to finish the match straight away.
            if (last) setTimeout(() => setConfirm('complete'), 350)
          }}
        />
      )}

      {confirm === 'complete' && (
        <Confirm
          title="Everyone has settled"
          message="Complete the match now?"
          confirmLabel="Complete match"
          cancelLabel="Not yet"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            run(() => {
              completeMatch(store!, team.id, match.id)
              toast('Match completed 🎉')
            })
          }}
        />
      )}
      {reopenConfirm}
    </section>
  )
}

function SettleSheet({ name, amount, onClose, onSave }: { name: string; amount: number; onClose: () => void; onSave: (how: { method: PayMethod; date: string; note?: string }) => void }) {
  const [method, setMethod] = useState<PayMethod>('upi')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  return (
    <Sheet title={`Settle ${name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          {name} paid <strong>{money(amount)}</strong>
        </p>
        <div>
          <span className="label">How</span>
          <ChoiceChips options={PAY_METHODS} value={method} onChange={setMethod} />
        </div>
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <input className="input" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button className="btn-primary" disabled={!date} onClick={() => onSave({ method, date, note })}>
          Mark settled
        </button>
      </div>
    </Sheet>
  )
}
