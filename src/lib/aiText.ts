// The AI answer is light markdown (## headings, - bullets, **bold**). Here it is cut
// for the short card and rewritten for WhatsApp, which has its own bold: *text*.
import type { AiKind } from '../types'

/** WhatsApp text: bold headings, • bullets, single-star bold. */
export function whatsappText(text: string, heading: string): string {
  const body = text
    .split('\n')
    .map((l) => l.trimEnd())
    .map((l) => {
      const head = l.match(/^#{1,4}\s+(.*)$/)
      if (head) return `\n*${head[1].replace(/\*+/g, '')}*`
      // A table row (the model sometimes ignores "no tables") becomes one bullet.
      if (/^\s*\|/.test(l)) {
        if (/^\s*\|?\s*:?-{2,}/.test(l)) return ''
        return `• ${l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join(' — ')}`.replace(/\*\*(.+?)\*\*/g, '*$1*')
      }
      const bullet = l.match(/^\s*[-*•]\s+(.*)$/)
      return (bullet ? `• ${bullet[1]}` : l).replace(/\*\*(.+?)\*\*/g, '*$1*')
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return `✨ *${heading}*\n\n${body}\n\n_AI suggestion made from the team’s numbers · All Around Cricket_`
}

/**
 * The start of an answer for the card: whole sections only, up to about `max`
 * characters (always at least the first section). `more` says something was left out.
 */
export function previewOf(text: string, max = 650): { text: string; more: boolean } {
  const lines = text.split('\n')
  const starts = lines.map((l, i) => (/^#{1,4}\s/.test(l) ? i : -1)).filter((i) => i >= 0)
  if (starts.length < 2) return text.length <= max ? { text, more: false } : { text: text.slice(0, max).replace(/\s+\S*$/, '') + '…', more: true }
  let end = lines.length
  for (let k = 1; k < starts.length; k++) {
    const upTo = lines.slice(0, starts[k]).join('\n')
    if (upTo.length > max) {
      end = starts[k]
      break
    }
  }
  const out = lines.slice(0, end).join('\n').trim()
  return { text: out, more: end < lines.length }
}

export const KIND_TITLE: Record<AiKind, string> = { plan: 'Match plan', review: 'Match review', player: 'Player plan' }
