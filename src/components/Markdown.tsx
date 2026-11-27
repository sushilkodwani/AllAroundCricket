// A small, safe renderer for the AI's light markdown: ## sections, - bullets,
// 1. numbered lists, | tables |, **bold** and *italic*. Everything becomes plain
// React nodes (no HTML is ever injected).
import type { ReactNode } from 'react'

type Block = { t: 'p'; text: string } | { t: 'ul'; items: { text: string; sub: boolean }[] } | { t: 'ol'; items: string[] } | { t: 'table'; head: string[]; rows: string[][] }
interface Section {
  title: string | null
  blocks: Block[]
}

const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

/** Splits the text into titled sections of paragraphs, lists and tables. */
export function parseMarkdown(text: string): Section[] {
  const sections: Section[] = [{ title: null, blocks: [] }]
  const cur = () => sections[sections.length - 1]
  const lines = text.split('\n').map((l) => l.trimEnd())
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const head = l.match(/^#{1,4}\s+(.*)$/)
    if (head) {
      sections.push({ title: head[1].replace(/\*+/g, '').trim(), blocks: [] })
      continue
    }
    if (!l.trim() || /^\s*[-_*]{3,}\s*$/.test(l)) continue
    const last = cur().blocks[cur().blocks.length - 1]
    if (/^\s*\|/.test(l)) {
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(cells(lines[i]))
        i++
      }
      i--
      if (rows.length) cur().blocks.push({ t: 'table', head: rows[0], rows: rows.slice(1) })
      continue
    }
    const bullet = l.match(/^(\s*)[-*•]\s+(.*)$/)
    if (bullet) {
      const item = { text: bullet[2], sub: bullet[1].length >= 2 }
      if (last?.t === 'ul') last.items.push(item)
      else cur().blocks.push({ t: 'ul', items: [item] })
      continue
    }
    const num = l.match(/^\s*\d+[.)]\s+(.*)$/)
    if (num) {
      if (last?.t === 'ol') last.items.push(num[1])
      else cur().blocks.push({ t: 'ol', items: [num[1]] })
      continue
    }
    cur().blocks.push({ t: 'p', text: l.trim() })
  }
  return sections.filter((s) => s.title || s.blocks.length)
}

/** **bold**, *italic* and `code` inside one line. */
export function inline(s: string): ReactNode[] {
  return s.split(/(\*\*.+?\*\*|\*[^*\s][^*]*?\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <span key={i}>{part.slice(1, -1)}</span>
    return part
  })
}

function BlockView({ b }: { b: Block }) {
  if (b.t === 'p') return <p>{inline(b.text)}</p>
  if (b.t === 'ul')
    return (
      <ul className="space-y-1.5">
        {b.items.map((it, i) => (
          <li key={i} className={`flex gap-2 ${it.sub ? 'ml-5' : ''}`}>
            <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            <span className="min-w-0">{inline(it.text)}</span>
          </li>
        ))}
      </ul>
    )
  if (b.t === 'ol')
    return (
      <ol className="space-y-1.5">
        {b.items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-alt text-[11px] font-bold">{i + 1}</span>
            <span className="min-w-0">{inline(it)}</span>
          </li>
        ))}
      </ol>
    )
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-xs">
        <thead>
          <tr>
            {b.head.map((h, i) => (
              <th key={i} className="bg-alt px-2 py-1.5 text-left font-semibold">
                {inline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r, ri) => (
            <tr key={ri} className="border-b border-line">
              {r.map((c, ci) => (
                <td key={ci} className="px-2 py-1.5 align-top">
                  {inline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Markdown({ text }: { text: string }) {
  const sections = parseMarkdown(text)
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      {sections.map((s, i) => {
        const summary = !!s.title && /^one line/i.test(s.title)
        return (
          <section key={i} className={summary ? 'rounded-xl bg-alt p-3' : i > 0 ? 'border-t border-line pt-4' : ''}>
            {s.title && <h3 className={`mb-2 font-bold ${summary ? 'text-xs uppercase tracking-wide text-muted' : 'text-[15px] text-accent'}`}>{s.title}</h3>}
            <div className={`space-y-2 ${summary ? 'font-semibold' : ''}`}>
              {s.blocks.map((b, j) => (
                <BlockView key={j} b={b} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
