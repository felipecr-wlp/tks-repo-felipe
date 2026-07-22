/* Renderiza los bloques de contenido de una leccion (contenido-como-codigo).
   Tipos: p, h, list, ol, table, callout, rule, script. Sin HTML crudo salvo el
   guion (script) que usa <span> para marcar roles: se parsea manualmente, no
   se inyecta dangerouslySetInnerHTML de contenido externo (el contenido es
   nuestro, versionado en el repo). */
import { AcademyIcon } from '@/lib/academy/icons'
import type { Block } from '@/lib/academy/types'
import { Lightbulb, AlertTriangle, Info } from 'lucide-react'

function asText(v: Block['v']): string {
  return Array.isArray(v) ? v.join(' ') : (v ?? '')
}
function asList(v: Block['v']): string[] {
  return Array.isArray(v) ? v : v ? [v] : []
}

const CALLOUT_STYLES: Record<string, { border: string; bg: string; icon: typeof Info }> = {
  tip: { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', icon: Lightbulb },
  warn: { border: 'border-amber-500/40', bg: 'bg-amber-500/10', icon: AlertTriangle },
  info: { border: 'border-sky-500/40', bg: 'bg-sky-500/10', icon: Info },
}

/** El guion trae <span>Rol:</span> texto por linea. Lo partimos por salto. */
function ScriptBlock({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim())
  return (
    <div className="my-4 space-y-2 rounded-lg border border-border bg-muted/40 p-4">
      {lines.map((line, i) => {
        const m = line.match(/^<span>(.*?)<\/span>\s*(.*)$/)
        if (m) {
          return (
            <p key={i} className="text-sm leading-relaxed">
              <span className="font-semibold text-foreground">{m[1]} </span>
              <span className="text-muted-foreground">{m[2]}</span>
            </p>
          )
        }
        return (
          <p key={i} className="text-sm leading-relaxed text-muted-foreground">
            {line.replace(/<\/?span>/g, '')}
          </p>
        )
      })}
    </div>
  )
}

export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h':
            return (
              <h3 key={i} className="mt-5 text-base font-semibold text-foreground">
                {asText(b.v)}
              </h3>
            )
          case 'p':
            return (
              <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                {asText(b.v)}
              </p>
            )
          case 'list':
            return (
              <ul key={i} className="ml-1 space-y-1.5">
                {asList(b.v).map((it, j) => (
                  <li key={j} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} className="ml-1 space-y-1.5">
                {asList(b.v).map((it, j) => (
                  <li key={j} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="shrink-0 font-semibold text-primary">{j + 1}.</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ol>
            )
          case 'table':
            return (
              <div key={i} className="my-3 overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  {b.head && (
                    <thead className="bg-muted/60">
                      <tr>
                        {b.head.map((h, j) => (
                          <th key={j} className="px-3 py-2 font-semibold text-foreground">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {(b.rows ?? []).map((row, r) => (
                      <tr key={r} className="border-t border-border">
                        {row.map((cell, c) => (
                          <td key={c} className="px-3 py-2 align-top text-muted-foreground">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'callout': {
            const st = CALLOUT_STYLES[b.style ?? 'info'] ?? CALLOUT_STYLES.info
            return (
              <div
                key={i}
                className={`my-3 flex gap-3 rounded-lg border ${st.border} ${st.bg} p-3`}
              >
                <AcademyIcon name={b.ci} className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                <p className="text-sm leading-relaxed text-foreground">{asText(b.v)}</p>
              </div>
            )
          }
          case 'rule':
            return (
              <div
                key={i}
                className="my-3 rounded-lg border-l-4 border-primary bg-primary/5 p-3"
              >
                {b.lab && (
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                    {b.lab}
                  </p>
                )}
                <p className="text-sm font-medium leading-relaxed text-foreground">
                  {asText(b.v)}
                </p>
              </div>
            )
          case 'script':
            return <ScriptBlock key={i} text={asText(b.v)} />
          default:
            return null
        }
      })}
    </div>
  )
}
