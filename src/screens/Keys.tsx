// Settings → Personal access keys (super admin only): everyone who can log in, each with their own key.
import { useState } from 'react'
import { PersonalKeyShare } from '../components/KeyShare'
import { RoleTag } from '../components/Profile'
import { Screen } from '../components/Screen'
import { Avatar, Empty, Pill } from '../components/ui'
import { maskPhone } from '../lib/phone'
import { useApp } from '../state/AppContext'

export function Keys() {
  const { isSuper, people, admins, allTeams, me } = useApp()
  const [open, setOpen] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  if (!isSuper) {
    return (
      <Screen title="Personal access keys" back="/settings">
        <Empty icon="🔒" title="Super admin only" />
      </Screen>
    )
  }

  const adminIds = new Set(admins.filter((a) => a.status === 'active').map((a) => a.personId))
  const everyone = people
    .filter((p) => p.id !== me?.id && (adminIds.has(p.id) || (!p.isGuest && p.access !== 'none' && p.teamIds.length > 0)))
    .sort((a, b) => Number(adminIds.has(b.id)) - Number(adminIds.has(a.id)) || a.name.localeCompare(b.name))
  const q = query.trim().toLowerCase()
  const shown = q ? everyone.filter((p) => p.name.toLowerCase().includes(q)) : everyone

  return (
    <Screen title="Personal access keys" back="/settings">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">Each person logs in with their own key, which works only with their mobile number. Tap a name, then Make key, and send it. People already logged in don’t need one until they log in again or the main key changes.</p>
        {everyone.length > 10 && <input className="input" type="search" placeholder="Search people" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" />}
        {everyone.length === 0 ? (
          <Empty icon="👥" title="Nobody to send a key to yet" text="Add admins and players first." />
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {shown.map((p) => {
              const teams = allTeams.filter((t) => p.teamIds.includes(t.id) || t.adminId === p.id)
              return (
                <div key={p.id}>
                  <button className="row active:bg-alt" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <Avatar name={p.name} personId={p.id} color={teams[0]?.color} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-medium">
                        <span className="truncate">{p.name}</span>
                        {adminIds.has(p.id) ? <Pill tone="brand">Admin</Pill> : <RoleTag person={p} />}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {maskPhone(p.phoneLast4)}
                        {teams.length > 0 && ` · ${teams.map((t) => t.name).join(', ')}`}
                      </span>
                    </span>
                    <span className="text-muted">{open === p.id ? '▾' : '▸'}</span>
                  </button>
                  {open === p.id && (
                    <div className="px-4 pb-4">
                      <PersonalKeyShare key={p.id} person={p} />
                    </div>
                  )}
                </div>
              )
            })}
            {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No one matches “{query}”.</p>}
          </div>
        )}
      </div>
    </Screen>
  )
}
