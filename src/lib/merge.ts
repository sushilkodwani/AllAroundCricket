// Id-based 3-way merge (PLAN §6.10). Used when the remote copy of a file changed
// since this device last read it: base = last read copy, local = this device's
// edits, remote = what is in the repo now.

type Rec = Record<string, unknown>
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function stampOf(r: Rec | undefined): string {
  if (!r) return ''
  return String(r.updatedAt ?? r.removedAt ?? r.joinedAt ?? r.createdAt ?? '')
}

/**
 * Rules: a change made on one side only wins; both sides changed the same
 * record → newest `updatedAt` wins; delete vs. edit → the edit is kept.
 */
export function mergeLists<T>(base: T[], local: T[], remote: T[], idOf: (t: T) => string): T[] {
  const b = new Map(base.map((x) => [idOf(x), x]))
  const l = new Map(local.map((x) => [idOf(x), x]))
  const r = new Map(remote.map((x) => [idOf(x), x]))

  // Keep the remote order, then anything only this device has.
  const ids = [...r.keys(), ...[...l.keys()].filter((id) => !r.has(id))]
  const out: T[] = []
  for (const id of ids) {
    const bv = b.get(id)
    const lv = l.get(id)
    const rv = r.get(id)
    let pick: T | undefined
    if (same(lv, rv)) pick = lv
    else if (same(lv, bv)) pick = rv // only remote changed (or deleted)
    else if (same(rv, bv)) pick = lv // only local changed (or deleted)
    else if (lv === undefined) pick = rv // deleted here, edited there → keep the edit
    else if (rv === undefined) pick = lv
    else pick = stampOf(rv as Rec) > stampOf(lv as Rec) ? rv : lv
    if (pick !== undefined) out.push(pick)
  }
  return out
}

/** Field-level 3-way merge for single-object files (config/app.json). */
export function mergeObjects(base: Rec | null, local: Rec, remote: Rec): Rec {
  const out: Rec = { ...remote }
  for (const key of new Set([...Object.keys(local), ...Object.keys(base ?? {})])) {
    const bv = base?.[key]
    if (same(local[key], bv)) continue // unchanged here → remote value stands
    if (key in local) out[key] = local[key]
    else delete out[key]
  }
  return out
}

interface ListSpec {
  key: string
  id: string
}

/** Which array a file holds and which field identifies a record in it. */
export function listSpecFor(path: string): ListSpec | null {
  if (path === 'people.json') return { key: 'people', id: 'id' }
  if (path === 'auth/credentials.json') return { key: 'credentials', id: 'personId' }
  if (path === 'teams.json') return { key: 'teams', id: 'id' }
  if (path === 'config/expense-categories.json') return { key: 'categories', id: 'id' }
  if (path === 'opponents.json') return { key: 'opponents', id: 'id' }
  if (path === 'tournaments.json') return { key: 'tournaments', id: 'id' }
  if (path === 'push/outbox.json') return { key: 'messages', id: 'id' }
  if (path.endsWith('/availability.json')) return { key: 'entries', id: 'id' }
  if (path === 'push/subscriptions.json') return { key: 'subscriptions', id: 'deviceId' }
  if (path.endsWith('/members.json')) return { key: 'members', id: 'personId' }
  if (path.endsWith('/matches.json')) return { key: 'matches', id: 'id' }
  if (path.endsWith('/funds.json')) return { key: 'entries', id: 'id' }
  return null
}

export function mergeFile(path: string, base: unknown, local: unknown, remote: unknown): unknown {
  if (remote === null || remote === undefined) return local
  if (local === null || local === undefined) return remote
  const spec = listSpecFor(path)
  if (!spec) return mergeObjects(base as Rec | null, local as Rec, remote as Rec)
  const list = (file: unknown) => ((file as Rec | null)?.[spec.key] as Rec[] | undefined) ?? []
  return {
    ...(remote as Rec),
    ...(local as Rec),
    [spec.key]: mergeLists(list(base), list(local), list(remote), (x) => String(x[spec.id])),
  }
}
