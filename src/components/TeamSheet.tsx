import { useState } from 'react'
import { createTeam, shortNameFor, updateTeam } from '../lib/domain'
import { setTeamLogo, useImage } from '../lib/images'
import { P } from '../lib/paths'
import { useApp } from '../state/AppContext'
import { TEAM_COLORS, type Team } from '../types'
import { PhotoPicker } from './PhotoPicker'
import { ErrorNote, Field, NumberInput, Sheet } from './ui'

/** Create or edit a team: name, short name (auto from initials), colour, logo, home ground, low-balance line. */
export function TeamSheet({ team, onClose, onCreated }: { team?: Team; onClose: () => void; onCreated?: (team: Team) => void }) {
  const { store, allTeams } = useApp()
  const [name, setName] = useState(team?.name ?? '')
  const [short, setShort] = useState(team?.shortName ?? '')
  const [shortEdited, setShortEdited] = useState(!!team)
  const [color, setColor] = useState(team?.color ?? TEAM_COLORS[allTeams.length % TEAM_COLORS.length].hex)
  const [ground, setGround] = useState(team?.homeGround ?? '')
  const [threshold, setThreshold] = useState(String(team?.lowBalanceThreshold ?? 500))
  const [error, setError] = useState<string | null>(null)
  const savedLogo = useImage(store, team ? P.teamLogo(team.id) : null, team?.logo)
  // undefined = unchanged; a data URL = new logo; null = remove.
  const [logo, setLogo] = useState<string | null | undefined>(undefined)
  if (!store) return null

  const shortName = shortEdited ? short : shortNameFor(name)

  function save() {
    try {
      const input = { name, shortName, color, homeGround: ground }
      const changedLogo = logo !== undefined && (logo ?? null) !== (savedLogo ?? null)
      if (team) {
        updateTeam(store!, team.id, { ...input, lowBalanceThreshold: Number(threshold) || 0 })
        if (changedLogo) setTeamLogo(store!, team.id, logo ?? null)
        onClose()
      } else {
        const created = createTeam(store!, input)
        if (logo) setTeamLogo(store!, created.id, logo)
        if (onCreated) onCreated(created)
        else onClose()
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Sheet title={team ? 'Edit team' : 'New team'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Team name">
          <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Royal Cricket Club" />
        </Field>
        <Field label="Short name" hint="Up to 4 letters, shown on cards.">
          <input
            className="input uppercase"
            value={shortName}
            maxLength={4}
            onChange={(e) => {
              setShortEdited(true)
              setShort(e.target.value.toUpperCase())
            }}
            placeholder="RCC"
          />
        </Field>
        <div>
          <span className="label">Colour</span>
          <div className="flex flex-wrap gap-2.5">
            {TEAM_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                aria-label={c.name}
                aria-pressed={color === c.hex}
                className={`h-11 w-11 rounded-full border-4 ${color === c.hex ? 'border-ink' : 'border-transparent'}`}
                style={{ background: c.hex }}
                onClick={() => setColor(c.hex)}
              />
            ))}
          </div>
        </div>
        <PhotoPicker label="Logo (optional)" round={false} current={logo === undefined ? savedLogo : logo} onChange={setLogo} fallback={<span className="text-lg">{shortName || '?'}</span>} />
        <Field label="Home ground (optional)">
          <input className="input" value={ground} maxLength={60} onChange={(e) => setGround(e.target.value)} />
        </Field>
        {team && (
          <Field label="Low balance line (₹)" hint="Players below this show up under the “Low balance” filter in Funds.">
            <NumberInput value={threshold} onChange={setThreshold} maxLength={6} ariaLabel="Low balance threshold" />
          </Field>
        )}
        <ErrorNote>{error}</ErrorNote>
        <button className="btn-primary" disabled={!name.trim()}>
          {team ? 'Save' : 'Create team'}
        </button>
      </form>
    </Sheet>
  )
}
