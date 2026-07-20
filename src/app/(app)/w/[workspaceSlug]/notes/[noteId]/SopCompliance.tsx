'use client'

/**
 * Cumplimiento obligatorio de un SOP: a quien se le EXIGE leer y confirmar.
 * Complementa el acuse voluntario (SopAcknowledge): aqui el admin ASIGNA
 * lectores requeridos (persona / equipo / departamento) y ve quien ya confirmo
 * la version vigente, quien esta desactualizado y quien sigue pendiente.
 *
 * Circuito:
 *  - GET    /api/notes/[id]/assignments  -> objetivos + roster + estatus + pools
 *  - POST   { target_type, target_id }   -> asigna (admin) + notifica
 *  - DELETE ?target_type=&target_id=      -> quita la asignacion (admin)
 *
 * Solo se muestra para documentos operativos (doc_kind !== 'note').
 */
import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import {
  ClipboardCheck, Loader2, Plus, X, User, Users, Building2,
  CheckCircle2, AlertTriangle, Circle,
} from 'lucide-react'
import { getInitials } from '@/lib/utils'

type TargetType = 'profile' | 'team' | 'space'

interface Target {
  type: TargetType
  id: string
  label: string
  member_count: number
}

interface RosterEntry {
  profile_id: string
  display_name: string
  avatar_url: string | null
  status: 'done' | 'outdated' | 'pending'
  sop_version: string | null
}

interface Pools {
  members: { profile_id: string; display_name: string; avatar_url: string | null }[]
  teams: { id: string; name: string }[]
  spaces: { id: string; name: string; is_restricted: boolean }[]
}

interface ComplianceState {
  current_version: string | null
  targets: Target[]
  roster: RosterEntry[]
  required_count: number
  done_count: number
  can_assign: boolean
  pools?: Pools
}

interface SopComplianceProps {
  noteId: string
}

const TARGET_ICON: Record<TargetType, typeof User> = {
  profile: User,
  team: Users,
  space: Building2,
}

export function SopCompliance({ noteId }: SopComplianceProps) {
  const [state, setState] = useState<ComplianceState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [showRoster, setShowRoster] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notes/${noteId}/assignments`)
      if (res.ok) setState(await res.json())
    } catch {
      // secundario: no romper la nota
    } finally {
      setLoading(false)
    }
  }, [noteId])

  useEffect(() => { load() }, [load])

  const assign = useCallback(async (target_type: TargetType, target_id: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/notes/${noteId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type, target_id }),
      })
      if (!res.ok) throw new Error()
      toast.success('Lector requerido asignado')
      setPicking(false)
      await load()
    } catch {
      toast.error('No se pudo asignar')
    } finally {
      setBusy(false)
    }
  }, [noteId, load])

  const unassign = useCallback(async (target_type: TargetType, target_id: string) => {
    setBusy(true)
    try {
      const qs = new URLSearchParams({ target_type, target_id }).toString()
      const res = await fetch(`/api/notes/${noteId}/assignments?${qs}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      toast.error('No se pudo quitar la asignación')
    } finally {
      setBusy(false)
    }
  }, [noteId, load])

  if (loading || !state) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Cargando cumplimiento…
      </div>
    )
  }

  // Sin lectores requeridos y sin poder asignar: no mostrar nada (documento libre).
  if (state.targets.length === 0 && !state.can_assign) return null

  const { required_count, done_count } = state
  const pct = required_count > 0 ? Math.round((done_count / required_count) * 100) : 0
  const allDone = required_count > 0 && done_count === required_count

  return (
    <section className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <ClipboardCheck className="w-5 h-5 text-[#2563EB] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Lectura obligatoria</p>
          <p className="text-xs text-muted-foreground">
            {required_count === 0
              ? 'Aún no hay lectores requeridos asignados.'
              : `${done_count} de ${required_count} confirmaron la versión vigente${state.current_version ? ` (v${state.current_version})` : ''}.`}
          </p>
        </div>

        {state.can_assign && (
          <button
            onClick={() => setPicking(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-accent transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Asignar
          </button>
        )}
      </div>

      {/* Barra de progreso */}
      {required_count > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cnBar(allDone)}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
        </div>
      )}

      {/* Chips de objetivos (a quien se le exige) */}
      {state.targets.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {state.targets.map(t => {
            const Icon = TARGET_ICON[t.type]
            return (
              <span
                key={`${t.type}:${t.id}`}
                className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 text-[11px] rounded-md border border-border bg-background text-foreground"
              >
                <Icon className="w-3 h-3 text-muted-foreground" />
                {t.label}
                {t.type !== 'profile' && (
                  <span className="text-muted-foreground">· {t.member_count}</span>
                )}
                {state.can_assign && (
                  <button
                    onClick={() => unassign(t.type, t.id)}
                    disabled={busy}
                    className="ml-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                    title="Quitar"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}

      {/* Selector de asignacion (admin) */}
      {picking && state.pools && (
        <AssignPicker pools={state.pools} busy={busy} onPick={assign} />
      )}

      {/* Roster de personas requeridas con su estatus */}
      {required_count > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <button
            onClick={() => setShowRoster(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showRoster ? 'Ocultar' : 'Ver'} lista de {required_count} {required_count === 1 ? 'persona' : 'personas'}
          </button>

          {showRoster && (
            <ul className="mt-2 space-y-1.5">
              {state.roster.map(r => (
                <li key={r.profile_id} className="flex items-center gap-2 text-xs">
                  <div className="w-5 h-5 rounded-full overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center text-[9px] font-medium">
                    {r.avatar_url ? (
                      <Image src={r.avatar_url} alt={r.display_name} width={20} height={20} className="object-cover" />
                    ) : getInitials(r.display_name)}
                  </div>
                  <span className="text-foreground truncate">{r.display_name}</span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function cnBar(allDone: boolean): string {
  return `h-full rounded-full transition-all ${allDone ? 'bg-emerald-500' : 'bg-[#2563EB]'}`
}

function StatusBadge({ status }: { status: RosterEntry['status'] }) {
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 ml-auto flex-shrink-0">
        <CheckCircle2 className="w-2.5 h-2.5" />
        confirmado
      </span>
    )
  }
  if (status === 'outdated') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 ml-auto flex-shrink-0">
        <AlertTriangle className="w-2.5 h-2.5" />
        desactualizado
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground ml-auto flex-shrink-0">
      <Circle className="w-2.5 h-2.5" />
      pendiente
    </span>
  )
}

// ── Selector: personas / equipos / departamentos ──────────────────────────────
function AssignPicker({
  pools, busy, onPick,
}: {
  pools: Pools
  busy: boolean
  onPick: (t: TargetType, id: string) => void
}) {
  const [tab, setTab] = useState<TargetType>('profile')
  const [q, setQ] = useState('')

  const query = q.trim().toLowerCase()
  const people = pools.members.filter(m => m.display_name.toLowerCase().includes(query))
  const teams = pools.teams.filter(t => t.name.toLowerCase().includes(query))
  const spaces = pools.spaces.filter(s => s.name.toLowerCase().includes(query))

  return (
    <div className="mt-3 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-1 mb-2">
        <TabBtn active={tab === 'profile'} onClick={() => setTab('profile')} Icon={User} label="Personas" />
        <TabBtn active={tab === 'team'} onClick={() => setTab('team')} Icon={Users} label="Equipos" />
        <TabBtn active={tab === 'space'} onClick={() => setTab('space')} Icon={Building2} label="Departamentos" />
      </div>

      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Buscar…"
        className="w-full mb-2 px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
      />

      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {tab === 'profile' && people.map(m => (
          <PickRow key={m.profile_id} label={m.display_name} disabled={busy} onClick={() => onPick('profile', m.profile_id)} />
        ))}
        {tab === 'team' && teams.map(t => (
          <PickRow key={t.id} label={t.name} disabled={busy} onClick={() => onPick('team', t.id)} />
        ))}
        {tab === 'space' && spaces.map(s => (
          <PickRow
            key={s.id}
            label={s.name}
            hint={s.is_restricted ? 'restringido' : undefined}
            disabled={busy}
            onClick={() => onPick('space', s.id)}
          />
        ))}
        {((tab === 'profile' && people.length === 0) ||
          (tab === 'team' && teams.length === 0) ||
          (tab === 'space' && spaces.length === 0)) && (
          <p className="text-xs text-muted-foreground py-3 text-center">Sin resultados</p>
        )}
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, Icon, label }: { active: boolean; onClick: () => void; Icon: typeof User; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
        active ? 'bg-[#2563EB] text-white' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      }`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  )
}

function PickRow({ label, hint, disabled, onClick }: { label: string; hint?: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left rounded-md hover:bg-accent transition-colors disabled:opacity-50"
    >
      <span className="text-foreground truncate flex-1">{label}</span>
      {hint && <span className="text-[10px] text-amber-600 flex-shrink-0">{hint}</span>}
      <Plus className="w-3 h-3 text-muted-foreground flex-shrink-0" />
    </button>
  )
}
