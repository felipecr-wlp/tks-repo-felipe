'use client'

/**
 * Rollup de cumplimiento de SOPs del workspace (Nivel 2, Paso 3).
 * Panel SOLO para admins encima de la lente de SOPs: cumplimiento global, totales
 * (obligatorios, firmados, firmas desactualizadas, lectores pendientes, revisiones
 * vencidas) y una tabla por departamento, con export CSV.
 *
 * Se auto-consulta GET /api/workspaces/[id]/sop-compliance. Si el usuario no es
 * admin la API responde 403 y este panel no renderiza nada (sin ruido para
 * lectores). El CSV usa la misma ruta con ?format=csv (BOM UTF-8, ñ/tildes OK).
 */
import { useEffect, useState } from 'react'
import { ShieldCheck, Download, BadgeCheck, ShieldAlert, Clock, CalendarX2 } from 'lucide-react'

interface DeptRow {
  name: string
  docs: number
  required: number
  done: number
  pending_outdated: number
  compliance: number
}

interface Totals {
  docs: number
  obligatorios: number
  approved: number
  approval_outdated: number
  overdue: number
  required: number
  done: number
  outdated: number
  pending: number
}

interface Rollup {
  can_view: boolean
  overall_compliance: number
  totals: Totals
  departments: DeptRow[]
}

interface SopComplianceRollupProps {
  workspaceId: string
}

function barTone(pct: number): string {
  if (pct >= 90) return 'bg-emerald-500'
  if (pct >= 60) return 'bg-amber-500'
  return 'bg-red-500'
}

export function SopComplianceRollup({ workspaceId }: SopComplianceRollupProps) {
  const [data, setData] = useState<Rollup | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch(`/api/workspaces/${workspaceId}/sop-compliance`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => { if (alive) setData(json) })
      .catch(() => { /* no admin o error: no romper la lente */ })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [workspaceId])

  // No admin (403) o aun cargando: no mostrar nada.
  if (loading || !data || !data.can_view) return null

  const { overall_compliance, totals, departments } = data
  const csvUrl = `/api/workspaces/${workspaceId}/sop-compliance?format=csv`

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          Cumplimiento de SOPs
        </h2>
        <a
          href={csvUrl}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border border-border bg-background text-muted-foreground hover:text-foreground transition-colors"
        >
          <Download className="w-3 h-3" />
          Exportar CSV
        </a>
      </div>

      {/* Cumplimiento global */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-xs text-muted-foreground">
            Lectores confirmados sobre requeridos
          </span>
          <span className="text-lg font-semibold text-foreground tabular-nums">
            {overall_compliance}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barTone(overall_compliance)}`}
            style={{ width: `${overall_compliance}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
          {totals.done} de {totals.required} confirmaciones · {totals.obligatorios} documentos con lectores asignados
        </p>
      </div>

      {/* Totales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <BadgeCheck className="w-3.5 h-3.5 text-emerald-600" />
            Aprobados
          </div>
          <p className="text-base font-semibold text-foreground tabular-nums mt-0.5">
            {totals.approved}<span className="text-xs text-muted-foreground font-normal">/{totals.docs}</span>
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
            Firmas viejas
          </div>
          <p className="text-base font-semibold text-foreground tabular-nums mt-0.5">
            {totals.approval_outdated}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            Pendientes
          </div>
          <p className="text-base font-semibold text-foreground tabular-nums mt-0.5">
            {totals.pending}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CalendarX2 className="w-3.5 h-3.5 text-red-600" />
            Rev. vencidas
          </div>
          <p className="text-base font-semibold text-foreground tabular-nums mt-0.5">
            {totals.overdue}
          </p>
        </div>
      </div>

      {/* Por departamento */}
      {departments.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground">
                <th className="text-left font-medium px-3 py-1.5">Departamento</th>
                <th className="text-right font-medium px-3 py-1.5">Docs</th>
                <th className="text-right font-medium px-3 py-1.5">Pend.</th>
                <th className="text-right font-medium px-3 py-1.5 w-32">Cumplimiento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {departments.map(d => (
                <tr key={d.name} className="text-foreground">
                  <td className="px-3 py-1.5 truncate max-w-[12rem]">{d.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{d.docs}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{d.pending_outdated}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${barTone(d.compliance)}`} style={{ width: `${d.compliance}%` }} />
                      </div>
                      <span className="tabular-nums w-8 text-right">{d.compliance}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
