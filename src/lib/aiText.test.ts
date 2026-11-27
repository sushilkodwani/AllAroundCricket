import { describe, expect, it } from 'vitest'
import { previewOf, whatsappText } from './aiText'

const section = (n: number) => `## Section ${n}\n- ${'point '.repeat(30)}\n- another **bold** point`

describe('ai text', () => {
  it('turns markdown into WhatsApp text', () => {
    const t = whatsappText('## Toss\n- Bat **first**\n- Why: wet outfield', 'Match plan · A vs B')
    expect(t).toContain('✨ *Match plan · A vs B*')
    expect(t).toContain('*Toss*')
    expect(t).toContain('• Bat *first*')
    expect(t).not.toContain('##')
    expect(t).not.toContain('**')
  })
  it('previews whole sections only and says when there is more', () => {
    const text = [1, 2, 3, 4, 5].map(section).join('\n\n')
    const p = previewOf(text, 650)
    expect(p.more).toBe(true)
    expect(p.text.startsWith('## Section 1')).toBe(true)
    expect(p.text).not.toContain('## Section 5')
    expect(p.text.endsWith('point')).toBe(true) // cut between sections, not mid-sentence
    expect(previewOf(section(1), 650).more).toBe(false)
  })
  it('cuts a short plain answer at a word', () => {
    const p = previewOf('word '.repeat(300), 100)
    expect(p.more).toBe(true)
    expect(p.text.length).toBeLessThan(110)
  })
})
