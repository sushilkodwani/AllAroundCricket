// Team → Expense categories (PLAN §16.6). Each team has its own list, run by its admin. Edits apply to new splits only;
// "delete" archives, so matches that used a category keep it.
import { useState } from 'react'
import { Screen } from '../components/Screen'
import { ChoiceChips, Confirm, Empty, ErrorNote, Field, NumberInput, Pill, Sheet, Toggle } from '../components/ui'
import { money } from '../lib/dates'
import { categoriesOf, moveCategory, saveCategory, setCategoryArchived } from '../lib/domain'
import { useApp, useFile } from '../state/AppContext'
import { P } from '../lib/paths'
import { useSheet } from '../state/router'
import { MODE_LABELS, type CategoryMode, type ExpenseCategory } from '../types'

const MODES: { value: CategoryMode; label: string }[] = [
  { value: 'mandatory', label: 'Mandatory' },
  { value: 'optional', label: 'Optional' },
  { value: 'manual', label: 'Manual' },
]
const MODE_HELP: Record<CategoryMode, string> = {
  mandatory: 'Added to every match automatically; an amount is required.',
  optional: 'Added to every match automatically; can be left empty or removed.',
  manual: 'Not added automatically; pick it with “+ Add category” when needed.',
}

export function ExpenseCategories({ teamId }: { teamId: string }) {
  const { store, canManage, allTeams, toast } = useApp()
  useFile(P.categories(teamId))
  const team = allTeams.find((t) => t.id === teamId)
  const categories = store ? categoriesOf(store, teamId) : []
  const back = `/teams/${teamId}`
  const sheet = useSheet()
  const [showDeleted, setShowDeleted] = useState(false)
  const [deleting, setDeleting] = useState<ExpenseCategory | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!canManage(teamId) || !store || !team) {
    return (
      <Screen title="Expense categories" back={back}>
        <Empty icon="🔒" title="Admins only" />
      </Screen>
    )
  }

  const live = categories.filter((c) => !c.archived).sort((a, b) => a.order - b.order)
  const archived = categories.filter((c) => c.archived).sort((a, b) => a.name.localeCompare(b.name))
  const editing = sheet.name === 'cat' ? categories.find((c) => c.id === sheet.arg) : undefined

  return (
    <Screen title="Expense categories" back={back}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">{team.name}: these are the costs split among the squad after a match. Changes apply to new splits only.</p>
        <button className="btn-primary" onClick={() => sheet.open('cat')}>
          + Add category
        </button>
        <ErrorNote>{error}</ErrorNote>

        {live.length === 0 ? (
          <Empty icon="🧾" title="No categories" text="Add at least one, e.g. Match fee." />
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {live.map((c, i) => (
              <div key={c.id} className="flex items-center gap-1 pl-4 pr-1">
                <button className="flex min-h-[56px] min-w-0 flex-1 items-center gap-2 py-2 text-left" onClick={() => sheet.open('cat', c.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-xs text-muted">{c.defaultAmount ? `Default ${money(c.defaultAmount)}` : 'No default amount'}</span>
                  </span>
                  <Pill tone={c.mode === 'mandatory' ? 'brand' : 'neutral'}>{MODE_LABELS[c.mode]}</Pill>
                </button>
                <button className="flex h-11 w-9 items-center justify-center text-muted disabled:opacity-30" disabled={i === 0} aria-label={`Move ${c.name} up`} onClick={() => moveCategory(store, teamId, c.id, -1)}>
                  ↑
                </button>
                <button className="flex h-11 w-9 items-center justify-center text-muted disabled:opacity-30" disabled={i === live.length - 1} aria-label={`Move ${c.name} down`} onClick={() => moveCategory(store, teamId, c.id, 1)}>
                  ↓
                </button>
                <button className="flex h-11 w-9 items-center justify-center text-bad" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {archived.length > 0 && (
          <>
            <div className="flex items-center justify-between px-1">
              <span className="text-sm text-muted">Show deleted ({archived.length})</span>
              <Toggle label="Show deleted categories" checked={showDeleted} onChange={setShowDeleted} />
            </div>
            {showDeleted && (
              <div className="card divide-y divide-line overflow-hidden">
                {archived.map((c) => (
                  <div key={c.id} className="row">
                    <span className="min-w-0 flex-1 truncate text-muted">{c.name}</span>
                    <button
                      className="btn-secondary min-h-[36px]"
                      onClick={() => {
                        try {
                          setCategoryArchived(store, teamId, c.id, false)
                          setError(null)
                        } catch (e) {
                          setError((e as Error).message)
                        }
                      }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {sheet.name === 'cat' && <CategorySheet teamId={teamId} category={editing} onClose={sheet.close} />}

      {deleting && (
        <Confirm
          title={`Delete ${deleting.name}?`}
          message="Removed from new matches. Matches that already used it keep it."
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            setCategoryArchived(store, teamId, deleting.id, true)
            toast(`${deleting.name} deleted`, () => setCategoryArchived(store, teamId, deleting.id, false))
            setDeleting(null)
          }}
        />
      )}
    </Screen>
  )
}

function CategorySheet({ teamId, category, onClose }: { teamId: string; category?: ExpenseCategory; onClose: () => void }) {
  const { store } = useApp()
  const [name, setName] = useState(category?.name ?? '')
  const [mode, setMode] = useState<CategoryMode>(category?.mode ?? 'optional')
  const [amount, setAmount] = useState(category?.defaultAmount ? String(category.defaultAmount) : '')
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet title={category ? 'Edit category' : 'New category'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          try {
            saveCategory(store!, teamId, { id: category?.id, name, mode, defaultAmount: Number(amount) || undefined })
            onClose()
          } catch (err) {
            setError((err as Error).message)
          }
        }}
      >
        <Field label="Name">
          <input className="input" value={name} maxLength={40} autoFocus={!category} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ground booking" />
        </Field>
        <div>
          <span className="label">Added to matches</span>
          <ChoiceChips options={MODES} value={mode} onChange={setMode} />
          <p className="mt-2 text-xs text-muted">{MODE_HELP[mode]}</p>
        </div>
        <Field label="Default amount (optional, ₹)" hint="Prefilled in every new split.">
          <NumberInput value={amount} onChange={setAmount} maxLength={7} placeholder="e.g. 600" ariaLabel="Default amount" />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={!name.trim()}>
          Save
        </button>
      </form>
    </Sheet>
  )
}
