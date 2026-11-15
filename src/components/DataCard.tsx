// Settings → Data (admin): JSON backup, CSV exports, restore.
import { useRef, useState } from 'react'
import { loadTeam } from '../lib/domain'
import { buildBackup, downloadFile, expensesCsv, fundsCsv, parseBackup, restoreBackup, stampedName, type Backup } from '../lib/exporter'
import { useApp } from '../state/AppContext'
import { Confirm, ErrorNote, MenuRow } from './ui'

export function DataCard() {
  const { store, allTeams, toast } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Backup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!store) return null

  async function run(fn: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = (kind: 'funds' | 'expenses') =>
    run(async () => {
      await Promise.all(allTeams.map((t) => loadTeam(store, t.id)))
      // One file with every team, each team's rows under the same header.
      const parts = allTeams.map((t) => (kind === 'funds' ? fundsCsv(store, t) : expensesCsv(store, t)))
      const [first, ...rest] = parts
      const body = (first ?? '') + rest.map((p) => p.split('\n').slice(1).join('\n')).join('')
      downloadFile(stampedName(kind === 'funds' ? 'fund-ledger' : 'match-expenses', 'csv'), body, 'text/csv')
    })

  return (
    <>
      <div className={`card divide-y divide-line overflow-hidden ${busy ? 'opacity-60' : ''}`}>
        <MenuRow
          label="Download full backup (JSON)"
          hint="Teams, players, matches, expenses, funds and categories. PINs are never included."
          onClick={() => void run(async () => downloadFile(stampedName('allaroundcricket-backup', 'json'), JSON.stringify(await buildBackup(store), null, 2), 'application/json'))}
        />
        <MenuRow label="Export fund ledger (CSV)" onClick={() => void exportCsv('funds')} />
        <MenuRow label="Export match expenses (CSV)" hint="One row per player per match." onClick={() => void exportCsv('expenses')} />
        <MenuRow label="Restore from backup…" onClick={() => fileRef.current?.click()} />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setError(null)
          file
            .text()
            .then((text) => setPending(parseBackup(text)))
            .catch((err) => setError((err as Error).message))
        }}
      />
      <div className="mt-2">
        <ErrorNote>{error}</ErrorNote>
      </div>

      {pending && (
        <Confirm
          title="Restore this backup?"
          message={`Backup from ${new Date(pending.exportedAt).toLocaleString('en-IN')}. It replaces the current teams, players, matches, expenses, funds and categories. PINs and the admin stay as they are. Type RESTORE to confirm.`}
          requireText="RESTORE"
          confirmLabel="Restore"
          danger
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const backup = pending
            setPending(null)
            void run(async () => {
              const n = await restoreBackup(store, backup)
              toast(`Backup restored (${n} files)`)
            })
          }}
        />
      )}
    </>
  )
}
