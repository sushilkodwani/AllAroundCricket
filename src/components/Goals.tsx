// A player's personal goals on their page: progress bars, ticked when reached.
// The player (or whoever may edit their profile) adds and removes them.
import { useState } from 'react'
import { todayISO } from '../lib/dates'
import { setGoals } from '../lib/domain'
import { GOAL_METRICS, MAX_GOALS, goalProgress, goalTitle, metricOf } from '../lib/goals'
import type { PlayerData } from '../lib/playerAnalysis'
import { uuid } from '../lib/uuid'
import { useApp } from '../state/AppContext'
import type { Goal, GoalMetric, Person } from '../types'
import { ChoiceChips, ErrorNote, Field, NumberInput, Segmented, Sheet } from './ui'

export function GoalsCard({ person, data, canEdit, own }: { person: Person; data: PlayerData; canEdit: boolean; own: boolean }) {
  const { store, toast } = useApp()
  const [adding, setAdding] = useState(false)
  const goals = person.goals ?? []
  if (!goals.length && !canEdit) return null

  function remove(id: string) {
    try {
      setGoals(store!, person.id, goals.filter((g) => g.id !== id))
      toast('Goal removed')
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{own ? 'My goals' : 'Goals'}</h3>
        {canEdit && goals.length < MAX_GOALS && (
          <button className="text-sm font-semibold text-accent" onClick={() => setAdding(true)}>
            + Add goal
          </button>
        )}
      </div>
      {goals.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Set a target, like 300 runs this year or an economy under 7, and watch the bar fill up.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {goals.map((g) => {
            const p = goalProgress(g, data)
            return (
              <li key={g.id}>
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 font-medium">
                    {p.done && <span aria-label="Reached">✅ </span>}
                    {goalTitle(g)}
                  </span>
                  {canEdit && (
                    <button className="-mr-2 flex h-8 w-8 shrink-0 items-center justify-center text-muted" onClick={() => remove(g.id)} aria-label={`Remove goal: ${goalTitle(g)}`}>
                      ✕
                    </button>
                  )}
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
                  <div className={`h-full rounded-full ${p.done ? 'bg-ok' : 'bg-brand'}`} style={{ width: `${p.share * 100}%` }} />
                </div>
                <p className="mt-0.5 text-xs text-muted">{p.done ? `Reached — ${p.text}` : p.text}</p>
              </li>
            )
          })}
        </ul>
      )}
      {adding && <AddGoalSheet person={person} onClose={() => setAdding(false)} />}
    </section>
  )
}

function AddGoalSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const { store, toast } = useApp()
  const year = todayISO().slice(0, 4)
  const [metric, setMetric] = useState<GoalMetric>('runs')
  const [target, setTarget] = useState('')
  const [period, setPeriod] = useState<'year' | 'all'>('year')
  const [error, setError] = useState<string | null>(null)
  const m = metricOf(metric)

  function save() {
    setError(null)
    const t = Number(target)
    const goal: Goal = { id: uuid(), metric, target: t, period, ...(period === 'year' ? { year } : {}), createdAt: new Date().toISOString() }
    try {
      setGoals(store!, person.id, [...(person.goals ?? []), goal])
      toast('Goal added')
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Sheet title="Add a goal" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <span className="label">What</span>
          <ChoiceChips options={GOAL_METRICS.map((x) => ({ value: x.value, label: x.label }))} value={metric} onChange={setMetric} />
        </div>
        <Field label={m.lower ? 'Target (at most)' : 'Target'} hint={m.lower ? 'Runs per over: lower is better.' : m.decimals ? 'Reached when the figure is at or above this.' : undefined}>
          <NumberInput value={target} onChange={setTarget} maxLength={6} placeholder={m.placeholder} ariaLabel="Target" decimal={!!m.decimals} />
        </Field>
        <div>
          <span className="label">When</span>
          <Segmented
            options={[
              { value: 'year', label: `This year (${year})` },
              { value: 'all', label: 'All time' },
            ]}
            value={period}
            onChange={setPeriod}
          />
        </div>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={!(Number(target) > 0)} onClick={save}>
          Add goal
        </button>
      </div>
    </Sheet>
  )
}
