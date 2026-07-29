'use client'

/**
 * Renderizador de markdown para las respuestas de KERN.
 *
 * El modelo contesta en markdown: si se pinta crudo salen los asteriscos a la
 * vista ("1. **Titulo del SOP**: ...") y la respuesta se lee como un archivo de
 * texto, no como una respuesta.
 *
 * Se resuelve con un parser propio, chico y a proposito limitado, que devuelve
 * ELEMENTOS DE REACT, nunca HTML inyectado. Sin `dangerouslySetInnerHTML` no
 * hay superficie de XSS aunque el modelo escupa etiquetas: lo que no reconoce
 * el parser queda como texto plano. Los links solo se vuelven links si son
 * http(s) o mailto.
 *
 * Subconjunto soportado: encabezados, listas (con y sin numero), checkboxes,
 * citas, separadores, bloques de codigo, tablas simples y, en linea, negrita,
 * cursiva, tachado, codigo y links. Lo demas se degrada a parrafo.
 */
import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ── Formato en linea ────────────────────────────────────────────────────────
// Un solo regex con alternativas: gana la que aparezca primero en el texto.
const INLINE_RE =
  /`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<![*\w])\*([^*\n]+)\*(?!\*)|~~([^~\n]+)~~|\[([^\]\n]+)\]\(([^)\s]+)\)/g

function isSafeHref(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^mailto:/i.test(url)
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${keyBase}-i${i++}`
    if (m[1] !== undefined) {
      out.push(
        <code key={k} className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]">
          {m[1]}
        </code>
      )
    } else if (m[2] !== undefined || m[3] !== undefined) {
      out.push(
        <strong key={k} className="font-semibold">
          {m[2] ?? m[3]}
        </strong>
      )
    } else if (m[4] !== undefined) {
      out.push(<em key={k}>{m[4]}</em>)
    } else if (m[5] !== undefined) {
      out.push(
        <span key={k} className="line-through opacity-70">
          {m[5]}
        </span>
      )
    } else if (m[6] !== undefined && m[7] !== undefined) {
      const href = m[7]
      out.push(
        isSafeHref(href) ? (
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80"
          >
            {m[6]}
          </a>
        ) : (
          <Fragment key={k}>{m[6]}</Fragment>
        )
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// ── Bloques ─────────────────────────────────────────────────────────────────
const BULLET_RE = /^\s*[-*•]\s+(.*)$/
const TASK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/
const NUM_RE = /^\s*(\d{1,3})[.)]\s+(.*)$/
const HEAD_RE = /^(#{1,4})\s+(.*)$/
const QUOTE_RE = /^\s*>\s?(.*)$/
const HR_RE = /^\s*(?:---+|\*\*\*+|___+)\s*$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Bloque de codigo con ```
    if (/^\s*```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      i++ // cierre
      blocks.push(
        <pre
          key={`b${key++}`}
          className="overflow-x-auto rounded-lg bg-foreground/[0.07] px-3 py-2 font-mono text-[11px] leading-relaxed"
        >
          <code>{body.join('\n')}</code>
        </pre>
      )
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    if (HR_RE.test(line)) {
      blocks.push(<hr key={`b${key++}`} className="border-border" />)
      i++
      continue
    }

    const head = HEAD_RE.exec(line)
    if (head) {
      const level = head[1].length
      blocks.push(
        <p
          key={`b${key++}`}
          className={cn(
            'font-semibold text-foreground',
            level <= 2 ? 'text-[15px]' : 'text-[13px]',
            blocks.length > 0 && 'pt-1'
          )}
        >
          {renderInline(head[2], `h${key}`)}
        </p>
      )
      i++
      continue
    }

    // Tabla: encabezado + linea de guiones + filas
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push(
        <div key={`b${key++}`} className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="border-b border-foreground/20 px-1.5 py-1 text-left font-semibold"
                  >
                    {renderInline(h, `th${key}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border-b border-foreground/10 px-1.5 py-1 align-top">
                      {renderInline(c, `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // Cita
    if (QUOTE_RE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        body.push(QUOTE_RE.exec(lines[i])![1])
        i++
      }
      blocks.push(
        <blockquote
          key={`b${key++}`}
          className="border-l-2 border-foreground/25 pl-2.5 italic opacity-90"
        >
          {renderInline(body.join(' '), `q${key}`)}
        </blockquote>
      )
      continue
    }

    // Checkboxes
    if (TASK_RE.test(line)) {
      const items: Array<{ done: boolean; text: string }> = []
      while (i < lines.length && TASK_RE.test(lines[i])) {
        const t = TASK_RE.exec(lines[i])!
        items.push({ done: t[1].toLowerCase() === 'x', text: t[2] })
        i++
      }
      blocks.push(
        <ul key={`b${key++}`} className="space-y-1">
          {items.map((it, ii) => (
            <li key={ii} className="flex items-start gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  'mt-[3px] flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-[3px] border text-[8px] font-bold',
                  it.done
                    ? 'border-transparent bg-[#caa800] text-white'
                    : 'border-foreground/35'
                )}
              >
                {it.done ? '✓' : ''}
              </span>
              <span className={cn('min-w-0', it.done && 'line-through opacity-60')}>
                {renderInline(it.text, `t${key}-${ii}`)}
              </span>
            </li>
          ))}
        </ul>
      )
      continue
    }

    // Lista con viñeta
    if (BULLET_RE.test(line)) {
      const items: string[] = []
      while (i < lines.length && BULLET_RE.test(lines[i]) && !TASK_RE.test(lines[i])) {
        items.push(BULLET_RE.exec(lines[i])![1])
        i++
      }
      blocks.push(
        <ul key={`b${key++}`} className="space-y-1">
          {items.map((it, ii) => (
            <li key={ii} className="flex items-start gap-1.5">
              <span
                aria-hidden="true"
                className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-foreground/50"
              />
              <span className="min-w-0">{renderInline(it, `u${key}-${ii}`)}</span>
            </li>
          ))}
        </ul>
      )
      continue
    }

    // Lista numerada. Se respeta el numero con el que arranca el modelo.
    if (NUM_RE.test(line)) {
      const items: Array<{ n: string; text: string }> = []
      while (i < lines.length && NUM_RE.test(lines[i])) {
        const n = NUM_RE.exec(lines[i])!
        items.push({ n: n[1], text: n[2] })
        i++
      }
      blocks.push(
        <ol key={`b${key++}`} className="space-y-1">
          {items.map((it, ii) => (
            <li key={ii} className="flex items-start gap-1.5">
              <span className="mt-[1px] flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[9px] font-semibold tabular-nums">
                {it.n}
              </span>
              <span className="min-w-0">{renderInline(it.text, `o${key}-${ii}`)}</span>
            </li>
          ))}
        </ol>
      )
      continue
    }

    // Parrafo: se juntan las lineas seguidas que no abren otro bloque.
    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !BULLET_RE.test(lines[i]) &&
      !NUM_RE.test(lines[i]) &&
      !HEAD_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i]) &&
      !HR_RE.test(lines[i]) &&
      !/^\s*```/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push(
      <p key={`b${key++}`} className="leading-relaxed">
        {renderInline(para.join(' '), `p${key}`)}
      </p>
    )
  }

  return <div className={cn('space-y-2', className)}>{blocks}</div>
}
