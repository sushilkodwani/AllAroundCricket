import { describe, expect, it } from 'vitest'
import { buildPdf, type PdfPage } from './pdf'

const page = (n: number): PdfPage => ({ jpeg: new Uint8Array([0xff, 0xd8, 1, 2, 3, n, 0xff, 0xd9]), width: 100, height: 140, ptWidth: 595, ptHeight: 842 })
const latin1 = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join('')

describe('PDF writer', () => {
  const pdf = buildPdf([page(1), page(2)], 'Season (2026) report')
  const text = latin1(pdf)

  it('has the header, the page count and the end marker', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.endsWith('%%EOF\n')).toBe(true)
    expect(text).toContain('/Count 2')
    expect(text).toContain('/MediaBox [0 0 595 842]')
  })

  it('points every cross-reference entry at the start of its object', () => {
    const start = Number(/startxref\n(\d+)\n/.exec(text)![1])
    expect(text.slice(start, start + 4)).toBe('xref')
    const lines = text.slice(start).split('\n')
    const [, count] = lines[1].split(' ').map(Number)
    expect(count).toBe(10) // the free entry, then catalog, pages, 2 × (image, content, page), info
    for (let n = 1; n < count; n++) {
      const offset = Number(lines[2 + n].slice(0, 10))
      expect(text.slice(offset, offset + `${n} 0 obj`.length)).toBe(`${n} 0 obj`)
    }
  })

  it('stores each picture whole, with its length', () => {
    const jpeg = latin1(page(1).jpeg)
    expect(text).toContain(`/Length ${page(1).jpeg.length} >>\nstream\n${jpeg}\nendstream`)
    expect(text).toContain('/Filter /DCTDecode')
  })

  it('keeps the title safe', () => {
    expect(text).toContain('/Title (Season  2026  report)')
  })

  it('refuses an empty document', () => {
    expect(() => buildPdf([])).toThrow()
  })
})
