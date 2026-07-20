'use client'

/**
 * Barra de metadatos de SOP: convierte cualquier nota en un documento operativo
 * de primera clase (SOP, flujo, indice, capacitacion) con ciclo de vida.
 * Todos los cambios se persisten con el `patch()` del NoteEditor (PATCH /api/notes).
 */
import { useState } from 'react'
import { ClipboardList, GitBranch, Library, GraduationCap, FileText, ChevronDown, CalendarClock, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type DocKind = 'note' | 'sop' | 'sop_flow' | 'sop_index' | 'training'
export type SopStatus = 'draft' | 'review' | 'active' | 'obsolete'

const DOC_KINDS: { value: DocKind; label: string; Icon: typeof FileText }[] = [
  { value: 'note',      label: 'Nota',            Icon: FileText },
  { value: 'sop',       label: 'SOP',             Icon: ClipboardList },
  { value: 'sop_flow',  label: 'Flujo',           Icon: GitBranch },
  { value: 'sop_index', label: 'Índice',          Icon: Library },
  { value: 'training',  label: 'Capacitación',    Icon: GraduationCap },
]

const STATUSES: { value: SopStatus; label: string; className: string }[] = [
  { value: 'draft',    label: 'Borrador',    className: 'bg-muted text-muted-foreground' },
  { value: 'review',   label: 'En revisión', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400' },
  { value: 'active',   label: 'Activo',      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  { value: 'obsolete', label: 'Obsoleto',    className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400' },
]

interface SopMetaBarProps {
  docKind: DocKind
  sopStatus: SopStatus | null
  sopVersion: string | null
  reviewDue: string | null
  onPatch: (data: Record<string, unknown>) => void
}

function isOverdue(reviewDue: string | null): boolean {
  if (!reviewDue) return false
  const today = new Date().toISOString().slice(0, 10)
  return reviewDue < today
}

export function SopMetaBar({ docKind, sopStatus, sopVersion, reviewDue, onPatch }: SopMetaBarProps) {
  const [kind, setKind] = useState<DocKind>(docKind)
  const [status, setStatus] = useState<SopStatus | null>(sopStatus)
  const [version, setVersion] = useState(sopVersion ?? '')
  const [due, setDue] = useState(reviewDue ?? '')
  const [showKindMenu, setShowKindMenu] = useState(false)

  const isDoc = kind !== 'note'
  const overdue = isOverdue(due || null)

  function handleKind(value: DocKind) {
    setKind(value)
    setShowKindMenu(false)
    // Al convertir a documento operativo por primera vez, arrancar en Borrador.
    if (value !== 'note' && !status) {
      setStatus('draft')
      onPatch({ doc_kind: value, sop_status: 'draft' })
    } else if (value === 'note') {
      onPatch({ doc_kind: value })
    } else {
      onPatch({ doc_kind: value })
    }
  }

  function handleStatus(value: SopStatus) {
    setStatus(value)
    onPatch({ sop_status: value })
  }

  function handleVersionBlur() {
    const v = version.trim()
    if (v === (sopVersion ?? '')) return
    onPatch({ sop_version: v || null })
  }

  function handleDueChange(value: string) {
    setDue(value)
    onPatch({ review_due: value || null })
  }

  const CurrentKind = DOC_KINDS.find(k => k.value === kind) ?? DOC_KINDS[0]

  return (
    <div className="mb-6 -mt-2 ml-1 flex flex-wrap items-center gap-2 text-xs">
      {/* Selector de tipo de documento */}
      <div className="relative">
        <button
          onClick={() => setShowKindMenu(v => !v)}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors',
            isDoc
              ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300'
              : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted'
          )}
          title="Tipo de documento"
        >
          <CurrentKind.Icon className="w-3.5 h-3.5" />
          {CurrentKind.label}
          <ChevronDown className="w-2.5 h-2.5" />
        </button>
        {showKindMenu && (
          <div
            className="absolute top-8 left-0 z-50 w-44 bg-popover border border-border rounded-lg shadow-raised py-1"
            onMouseLeave={() => setShowKindMenu(false)}
          >
            {DOC_KINDS.map(opt => (
              <button
                key={opt.value}
                onClick={() => handleKind(opt.value)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors text-foreground',
                  opt.value === kind && 'bg-accent/50'
                )}
              >
                <opt.Icon className="w-3.5 h-3.5" />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isDoc && (
        <>
          {/* Estatus */}
          <div className="flex items-center gap-1">
            {STATUSES.map(s => (
              <button
                key={s.value}
                onClick={() => handleStatus(s.value)}
                className={cn(
                  'px-2 py-1 rounded-md font-medium transition-all',
                  status === s.value ? s.className : 'bg-transparent text-muted-foreground/60 hover:text-foreground'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Version */}
          <div className="flex items-center gap-1 text-muted-foreground">
            <span className="font-mono text-[10px] uppercase tracking-wide">v</span>
            <input
              value={version}
              onChange={e => setVersion(e.target.value)}
              onBlur={handleVersionBlur}
              placeholder="1.0"
              className="w-14 px-1.5 py-1 rounded-md bg-muted/50 border border-transparent focus:border-border outline-none text-foreground"
            />
          </div>

          {/* Proxima revision */}
          <div
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-md border',
              overdue
                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400'
                : 'border-border bg-muted/50 text-muted-foreground'
            )}
            title={overdue ? 'Revisión vencida' : 'Próxima revisión'}
          >
            {overdue ? <AlertTriangle className="w-3.5 h-3.5" /> : <CalendarClock className="w-3.5 h-3.5" />}
            <input
              type="date"
              value={due}
              onChange={e => handleDueChange(e.target.value)}
              className="bg-transparent outline-none text-inherit"
            />
          </div>
        </>
      )}
    </div>
  )
}
