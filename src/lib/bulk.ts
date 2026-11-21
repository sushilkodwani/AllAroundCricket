// Bulk add: one player per line.
import { normalizePhone } from './phone'

export interface BulkLine {
  raw: string
  name: string
  phone?: string
  error?: string
}

/**
 * Each line: a name followed by a 10-digit number, e.g. "Rahul Sharma 9876543210". With
 * `phoneOptional` (opponents' players) a line may be just a name; `error` is then unset and `phone` empty.
 */
export function parseBulk(text: string, phoneOptional = false): BulkLine[] {
  const seen = new Set<string>()
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/^(.*?)[\s,;:-]*((?:\+?91[\s-]*)?0?[\d][\d\s-]{8,})$/)
      const name = (m ? m[1] : raw).replace(/[\s,;:-]+$/, '').trim()
      if (!m && phoneOptional) return name ? { raw, name } : { raw, name, error: 'Name is missing' }
      if (!m) return { raw, name, error: 'No mobile number found' }
      const p = normalizePhone(m[2])
      if (!p.ok) return { raw, name, error: p.error }
      if (!name) return { raw, name, error: 'Name is missing' }
      if (seen.has(p.phone)) return { raw, name, error: 'Same number as a line above' }
      seen.add(p.phone)
      return { raw, name, phone: p.phone }
    })
}
