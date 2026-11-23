// Dev only (never imported by the app): a preview sheet of the shot stickers.
// From the dev server's page:  (await import('/src/dev/shotPreview.tsx')).mount()
import { createRoot } from 'react-dom/client'
import { ShotIcon } from '../components/ShotIcons'
import { SHOT_LABELS, type ShotType } from '../types'

const ALL = Object.keys(SHOT_LABELS) as ShotType[]
const RUNS = [35, 16, 8, 5, 5, 5, 3, 2, 2, 2, 1, 1]

function Grid({ left }: { left?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {ALL.map((t, i) => (
        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgb(var(--text) / 0.08)', borderRadius: 14, padding: '8px 10px', color: 'rgb(var(--text))' }}>
          <span style={{ color: 'rgb(var(--text-muted))' }}>
            <ShotIcon type={t} size={56} left={left} />
          </span>
          <span>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{SHOT_LABELS[t]}</span>
            <span style={{ display: 'block', fontSize: 14 }}>{RUNS[i]} runs</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export function mount() {
  const el = document.createElement('div')
  el.id = 'shot-preview'
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:rgb(var(--bg));color:rgb(var(--text));padding:12px;font-family:system-ui'
  document.body.appendChild(el)
  createRoot(el).render(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <b>Right-handed</b>
      <Grid />
      <b>Left-handed</b>
      <Grid left />
    </div>,
  )
  return 'ok'
}
