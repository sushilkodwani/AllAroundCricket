// A tiny PDF writer: each page is one picture (a JPEG) that fills the page. No library needed,
// and it opens anywhere. `buildPdf` is pure (bytes in, bytes out); the rest is browser glue.
import { track } from './usage'

export interface PdfPage {
  /** The JPEG file's bytes. */
  jpeg: Uint8Array
  /** The picture's size in pixels. */
  width: number
  height: number
  /** The page size in points (A4 portrait is 595 × 842). */
  ptWidth: number
  ptHeight: number
}

const enc = new TextEncoder()
const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, ' ')

/** Builds a PDF with one full-page picture per page. */
export function buildPdf(pages: PdfPage[], title = 'Report'): Uint8Array {
  if (pages.length === 0) throw new Error('A PDF needs at least one page.')
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b
    chunks.push(bytes)
    length += bytes.length
  }
  const obj = (n: number, body: (Uint8Array | string)[]) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
    for (const part of body) push(part)
    push('\nendobj\n')
  }

  push('%PDF-1.4\n')
  const kids = pages.map((_, k) => `${5 + 3 * k} 0 R`).join(' ')
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>'])
  obj(2, [`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`])
  pages.forEach((p, k) => {
    const img = 3 + 3 * k
    const content = `q ${p.ptWidth} 0 0 ${p.ptHeight} 0 0 cm /Im0 Do Q`
    obj(img, [`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream'])
    obj(img + 1, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`])
    obj(img + 2, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.ptWidth} ${p.ptHeight}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${img + 1} 0 R >>`])
  })
  const info = 3 + 3 * pages.length
  obj(info, [`<< /Title (${ascii(title)}) /Producer (All Around Cricket) >>`])

  const xref = length
  const count = info + 1
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  push(table)
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** A4 portrait, in points. */
export const A4 = { w: 595, h: 842 }

/** Turns canvases (each one A4 page) into a PDF. */
export async function canvasesToPdf(canvases: HTMLCanvasElement[], title: string): Promise<Blob> {
  const pages: PdfPage[] = []
  for (const c of canvases) {
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) throw new Error('Could not create the report.')
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height, ptWidth: A4.w, ptHeight: A4.h })
  }
  return new Blob([buildPdf(pages, title) as BlobPart], { type: 'application/pdf' })
}

/** Shares the PDF where the phone supports it (WhatsApp, email, Drive); otherwise downloads it. */
export async function sharePdf(blob: Blob, filename: string, caption: string): Promise<'shared' | 'downloaded'> {
  track('act.share')
  const file = new File([blob], filename, { type: 'application/pdf' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: caption })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared' // the user closed the share sheet
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}
