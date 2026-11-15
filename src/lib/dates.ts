// Local-date helpers. "Today" always comes from local date parts — never
// toISOString(), which gives the UTC date (wrong before 05:30 in India).

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now)
}

export function nowHM(now: Date = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** Local midnight of a YYYY-MM-DD date. */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000)
}

/** "Sat 22 Nov 2026" */
export function fmtDate(iso: string, withYear = true): string {
  const d = parseISODate(iso)
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`
}

/** "22 Nov" (adds the year when it isn't the current one) */
export function fmtDayMonth(iso: string, today = todayISO()): string {
  const d = parseISODate(iso)
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return `${d.getDate()} ${MON[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`
}

/** "7:00 AM" from "07:00" */
export function fmtTime(hm?: string): string {
  if (!hm) return ''
  const [h, m] = hm.split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`
}

/** { dow: 'SAT', day: '22', mon: 'NOV' } for the date chip on match rows. */
export function dateChip(iso: string): { dow: string; day: string; mon: string } {
  const d = parseISODate(iso)
  return { dow: DOW[d.getDay()].toUpperCase(), day: String(d.getDate()), mon: MON[d.getMonth()].toUpperCase() }
}

/** "today", "tomorrow", "in 3 days", "yesterday", "3 days ago" */
export function relativeDay(iso: string, today = todayISO()): string {
  const n = daysBetween(today, iso)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

/** "15 Nov 2026" from an ISO timestamp, in local time. */
export function fmtStamp(isoTimestamp?: string): string {
  if (!isoTimestamp) return ''
  const d = new Date(isoTimestamp)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`
}

export const nowStamp = () => new Date().toISOString()

/** Whole rupees with Indian grouping: ₹1,23,456 */
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
export function money(n: number): string {
  return n < 0 ? `−₹${inr.format(-n)}` : `₹${inr.format(n)}`
}
