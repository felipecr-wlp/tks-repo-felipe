'use client'

/**
 * Lente "Procesos y SOPs": vista transversal de todos los documentos operativos
 * del workspace (doc_kind <> 'note'), filtrable por departamento, tipo y estatus,
 * con las revisiones vencidas resaltadas arriba.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ClipboardList, GitBranch, Library, GraduationCap, FileText,
  AlertTriangle, CalendarClock,
} from 'lucide-react'
import { NoteIcon } from '@/lib/note-icons'
import { cn, timeAgo } from '@/lib/utils'
import { SopComplianceRollup } from './SopComplianceRollup'

type DocKind = 'sop' | 'sop_flow' | 'sop_index' | 'training'
type SopStatus = 'draft' | 'review' | 'active' | 'obsolete'

export interface SopRow {
  id: string
  title: string
  icon: string | null
  doc_kind: DocKind
  sop_status: SopStatus | null
  sop_version: string | null
  review_due: string | null
  updated_at: string
  space: { id: string; name: string; color: string | null } | null
  author: { display_name: string | null } | null
}

interface SopsLensProps {
  sops: SopRow[]
  workspaceSlug: string
  workspaceId: string
}

const KIND_META: Record<DocKind, { label: string; Icon: typeof FileText }> = {
  sop:       { label: 'SOP',          Icon: ClipboardList },
  sop_flow:  { label: 'Flujo',        Icon: GitBranch },
  sop_index: { label: 'Índice',       Icon: Library },
  training:  { label: 'Capacitación', Icon: GraduationCap },
}

const STATUS_META: Record<SopStatus, { label: string; className: string }> = {
  draft:    { label: 'Borrador',    className: 'bg-muted text-muted-foreground' },
  review:   { label: 'En revisión', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400' },
  active:   { label: 'Activo',      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  obsolete: { label: 'Obsoleto',    className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400' },
}

function isOverdue(reviewDue: string | null): boolean {
  if (!reviewDue) return false
  return reviewDue < new Date().toISOString().slice(0, 10)
}

export function SopsLens({ sops, workspaceSlug, workspaceId }: SopsLensProps) {
  const [deptFilter, setDeptFilter] = useState<string>('all')
  const [kindFilter, setKindFilter] = useState<DocKind | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<SopStatus | 'all'>('all')

  // Departamentos presentes en los documentos (para el selector).
  const departments = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string | null }>()
    for (const s of sops) {
      if (s.space) map.set(s.space.id, s.space)
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [sops])

  const filtered = useMemo(() => {
    return sops.filter(s => {
      if (deptFilter === 'none' && s.space) return false
      if (deptFilter !== 'all' && deptFilter !== 'none' && s.space?.id !== deptFilter) return false
      if (kindFilter !== 'all' && s.doc_kind !== kindFilter) return false
      if (statusFilter !== 'all' && s.sop_status !== statusFilter) return false
      return true
    })
  }, [sops, deptFilter, kindFilter, statusFilter])

  const overdue = filtered.filter(s => isOverdue(s.review_due) && s.sop_status !== 'obsolete')

  // Conteos para el encabezado.
  const counts = useMemo(() => {
    const c = { active: 0, review: 0, draft: 0, obsolete: 0 }
    for (const s of sops) if (s.sop_status) c[s.sop_status]++
    return c
  }, [sops])

  return (
    <div className="px-8 py-10 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-blue-600" />
          Procesos y SOPs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Todos los procedimientos, flujos y capacitaciones del workspace en un solo lugar.
        </p>
        <div className="flex flex-wrap gap-3 mt-3 text-xs text-muted-foreground">
          <span><strong className="text-emerald-600">{counts.active}</strong> activos</span>
          <span><strong className="text-amber-600">{counts.review}</strong> en revisión</span>
          <span><strong className="text-foreground">{counts.draft}</strong> borradores</span>
          {overdue.length > 0 && (
            <span className="text-red-600 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              <strong>{overdue.length}</strong> con revisión vencida
            </span>
          )}
        </div>
      </div>

      {/* Cumplimiento (solo admins; se auto-oculta para lectores) */}
      <SopComplianceRollup workspaceId={workspaceId} />

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-5 text-xs">
        {/* Departamento */}
        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          className="px-2 py-1.5 rounded-md bg-muted/50 border border-border text-foreground outline-none"
        >
          <option value="all">Todos los departamentos</option>
          {departments.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
          <option value="none">Sin departamento</option>
        </select>

        {/* Tipo */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setKindFilter('all')}
            className={cn('px-2 py-1.5 rounded-md transition-colors', kindFilter === 'all' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'bg-muted/50 text-muted-foreground hover:text-foreground')}
          >
            Todo
          </button>
          {(Object.keys(KIND_META) as DocKind[]).map(k => {
            const Icon = KIND_META[k].Icon
            return (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className={cn('flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors', kindFilter === k ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'bg-muted/50 text-muted-foreground hover:text-foreground')}
              >
                <Icon className="w-3.5 h-3.5" />
                {KIND_META[k].label}
              </button>
            )
          })}
        </div>

        {/* Estatus */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as SopStatus | 'all')}
          className="px-2 py-1.5 rounded-md bg-muted/50 border border-border text-foreground outline-none"
        >
          <option value="all">Cualquier estatus</option>
          {(Object.keys(STATUS_META) as SopStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-500/10 text-blue-600 mb-3">
            <ClipboardList className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">Aún no hay procesos aquí</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Crea una nota, ábrela y márcala como SOP con la barra de tipo de documento. Aparecerá aquí automáticamente.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          {filtered.map(s => {
            const kind = KIND_META[s.doc_kind]
            const overdueRow = isOverdue(s.review_due) && s.sop_status !== 'obsolete'
            return (
              <Link
                key={s.id}
                href={`/w/${workspaceSlug}/notes/${s.id}`}
                className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
              >
                <NoteIcon icon={s.icon} size={16} className="flex-shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {s.title || 'Sin título'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <kind.Icon className="w-3 h-3" />{kind.label}
                    </span>
                    {s.space && (
                      <span
                        className="inline-flex items-center gap-1"
                        style={s.space.color ? { color: s.space.color } : undefined}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.space.color ?? 'currentColor' }} />
                        {s.space.name}
                      </span>
                    )}
                    {s.sop_version && <span className="font-mono">v{s.sop_version}</span>}
                    <span>actualizada {timeAgo(s.updated_at)}</span>
                    {s.review_due && (
                      <span className={cn('inline-flex items-center gap-1', overdueRow && 'text-red-600 font-medium')}>
                        {overdueRow ? <AlertTriangle className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
                        rev. {s.review_due}
                      </span>
                    )}
                  </div>
                </div>
                {s.sop_status && (
                  <span className={cn('flex-shrink-0 px-2 py-0.5 rounded-md text-[10px] font-medium', STATUS_META[s.sop_status].className)}>
                    {STATUS_META[s.sop_status].label}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
