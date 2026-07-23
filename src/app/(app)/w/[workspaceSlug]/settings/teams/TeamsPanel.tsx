'use client'

/**
 * TeamsPanel, lista equipos del workspace, permite renombrar, cambiar metodologia,
 * eliminar y GESTIONAR MIEMBROS (agregar/quitar personas del pool del workspace,
 * fijar rol de equipo admin/member). Crear equipos usa el flujo /w/[slug]/teams/new.
 */
import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import { getInitials } from '@/lib/utils'
import { UsersRound, Plus, Pencil, Check, X, ChevronDown, ChevronRight, UserPlus, Archive, ArchiveRestore, Lock, Building2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'

interface Team {
  id: string
  name: string
  slug: string
  description: string | null
  methodology: string
  member_count: number
  is_archived: boolean
  space_id: string | null
}

interface Department {
  id: string
  name: string
  is_restricted: boolean
}

interface TeamMember {
  profile_id: string
  role: string
  display_name: string
  email: string
  avatar_url: string | null
}

interface WsPerson {
  profile_id: string
  display_name: string
  email: string
  avatar_url: string | null
}

export function TeamsPanel({
  workspaceSlug,
  workspaceId,
  initialTeams,
  departments,
}: {
  workspaceSlug: string
  workspaceId: string
  initialTeams: Team[]
  departments: Department[]
}) {
  const router = useRouter()
  const [teams, setTeams] = useState<Team[]>(initialTeams)
  const deptById = new Map(departments.map((d) => [d.id, d]))
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  // ── Gestion de miembros ────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<string | null>(null)
  const [membersByTeam, setMembersByTeam] = useState<Record<string, TeamMember[]>>({})
  const [loadingMembers, setLoadingMembers] = useState<string | null>(null)
  const [wsPool, setWsPool] = useState<WsPerson[] | null>(null)
  const [addSelection, setAddSelection] = useState<Record<string, string>>({})

  function startEdit(t: Team) {
    setEditing(t.id)
    setDraftName(t.name)
  }

  async function saveName(t: Team) {
    const name = draftName.trim()
    if (name.length < 2) {
      toast.error('El nombre debe tener al menos 2 caracteres')
      return
    }
    setBusy(t.id)
    try {
      const res = await fetch(`/api/teams/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar')
      toast.success('Equipo actualizado')
      setTeams((prev) => prev.map((x) => (x.id === t.id ? { ...x, name } : x)))
      setEditing(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  async function changeMethodology(t: Team, methodology: string) {
    setBusy(t.id)
    try {
      const res = await fetch(`/api/teams/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ methodology }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar')
      setTeams((prev) => prev.map((x) => (x.id === t.id ? { ...x, methodology } : x)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  async function changeDepartment(t: Team, rawValue: string) {
    const space_id = rawValue === '' ? null : rawValue
    setBusy(t.id)
    try {
      const res = await fetch(`/api/teams/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space_id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al mover de departamento')
      setTeams((prev) => prev.map((x) => (x.id === t.id ? { ...x, space_id } : x)))
      toast.success('Departamento actualizado')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  async function toggleArchived(t: Team) {
    const next = !t.is_archived
    setBusy(t.id)
    try {
      const res = await fetch(`/api/teams/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_archived: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al actualizar')
      setTeams((prev) => prev.map((x) => (x.id === t.id ? { ...x, is_archived: next } : x)))
      toast.success(next ? 'Equipo desactivado' : 'Equipo activado')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  async function removeTeam(t: Team) {
    if (
      !(await confirmDialog({
        message: `¿Eliminar el equipo ${t.name}? Se perderá su configuración. Los proyectos asociados pueden verse afectados.`,
        destructive: true,
        confirmLabel: 'Eliminar',
      }))
    )
      return
    setBusy(t.id)
    try {
      const res = await fetch(`/api/teams/${t.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Error al eliminar')
      }
      toast.success('Equipo eliminado')
      setTeams((prev) => prev.filter((x) => x.id !== t.id))
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  // ── Miembros ────────────────────────────────────────────────────────────────
  async function toggleMembers(t: Team) {
    if (expanded === t.id) {
      setExpanded(null)
      return
    }
    setExpanded(t.id)
    // Carga el pool del workspace una sola vez
    if (wsPool === null) {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/members`)
        const data = await res.json()
        if (res.ok) {
          setWsPool(
            (data.members ?? []).map((m: { profile_id: string; display_name: string; email: string; avatar_url: string | null }) => ({
              profile_id: m.profile_id,
              display_name: m.display_name,
              email: m.email,
              avatar_url: m.avatar_url,
            }))
          )
        }
      } catch {
        /* silencioso: el picker quedara vacio */
      }
    }
    // Carga miembros del equipo si no estan en cache
    if (!membersByTeam[t.id]) {
      setLoadingMembers(t.id)
      try {
        const res = await fetch(`/api/teams/${t.id}/members`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Error al cargar miembros')
        setMembersByTeam((prev) => ({ ...prev, [t.id]: data.members ?? [] }))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al cargar miembros')
      } finally {
        setLoadingMembers(null)
      }
    }
  }

  function bumpCount(teamId: string, delta: number) {
    setTeams((prev) => prev.map((x) => (x.id === teamId ? { ...x, member_count: Math.max(0, x.member_count + delta) } : x)))
  }

  async function addMember(t: Team) {
    const profileId = addSelection[t.id]
    if (!profileId) return
    setBusy(t.id)
    try {
      const res = await fetch(`/api/teams/${t.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, role: 'member' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al agregar')
      const person = (wsPool ?? []).find((p) => p.profile_id === profileId)
      if (person) {
        const newMember: TeamMember = { ...person, role: 'member' }
        setMembersByTeam((prev) => ({ ...prev, [t.id]: [...(prev[t.id] ?? []), newMember] }))
        bumpCount(t.id, 1)
      }
      setAddSelection((prev) => ({ ...prev, [t.id]: '' }))
      toast.success('Miembro agregado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  async function changeMemberRole(t: Team, profileId: string, role: 'admin' | 'member') {
    setBusy(t.id)
    try {
      const res = await fetch(`/api/teams/${t.id}/members/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al actualizar')
      setMembersByTeam((prev) => ({
        ...prev,
        [t.id]: (prev[t.id] ?? []).map((m) => (m.profile_id === profileId ? { ...m, role } : m)),
      }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  async function removeMember(t: Team, m: TeamMember) {
    if (
      !(await confirmDialog({
        message: `¿Quitar a ${m.display_name} del equipo ${t.name}?`,
        destructive: true,
        confirmLabel: 'Quitar',
      }))
    )
      return
    setBusy(t.id)
    try {
      const res = await fetch(`/api/teams/${t.id}/members/${m.profile_id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Error al quitar')
      }
      setMembersByTeam((prev) => ({
        ...prev,
        [t.id]: (prev[t.id] ?? []).filter((x) => x.profile_id !== m.profile_id),
      }))
      bumpCount(t.id, -1)
      toast.success('Miembro quitado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  function availableToAdd(teamId: string): WsPerson[] {
    const current = new Set((membersByTeam[teamId] ?? []).map((m) => m.profile_id))
    return (wsPool ?? []).filter((p) => !current.has(p.profile_id))
  }

  // Agrupar por departamento: cada grupo con su encabezado. Los equipos sin
  // departamento van al final en el grupo "Sin departamento".
  const groups: Array<{ key: string; label: string; is_restricted: boolean; hasDept: boolean; items: Team[] }> = []
  const idxByKey = new Map<string, number>()
  for (const t of teams) {
    const dept = t.space_id ? deptById.get(t.space_id) : undefined
    const key = dept ? dept.id : '__none__'
    let idx = idxByKey.get(key)
    if (idx === undefined) {
      idx = groups.length
      idxByKey.set(key, idx)
      groups.push({
        key,
        label: dept ? dept.name : 'Sin departamento',
        is_restricted: dept?.is_restricted ?? false,
        hasDept: !!dept,
        items: [],
      })
    }
    groups[idx].items.push(t)
  }
  groups.sort((a, b) => {
    if (a.hasDept !== b.hasDept) return a.hasDept ? -1 : 1
    return a.label.localeCompare(b.label, 'es')
  })

  const renderTeamRow = (t: Team) => {
            const isOpen = expanded === t.id
            const members = membersByTeam[t.id] ?? []
            const pool = availableToAdd(t.id)
            return (
              <div key={t.id}>
                <div className="px-4 py-3 flex items-center gap-3">
                  <button
                    onClick={() => toggleMembers(t)}
                    className="flex-shrink-0 w-8 h-8 rounded-lg bg-muted flex items-center justify-center hover:bg-accent"
                    title={isOpen ? 'Ocultar miembros' : 'Gestionar miembros'}
                    aria-label={isOpen ? 'Ocultar miembros' : 'Gestionar miembros'}
                  >
                    {isOpen ? (
                      <ChevronDown size={15} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={15} className="text-muted-foreground" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {editing === t.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          maxLength={80}
                          className="flex-1 px-2 py-1 text-sm border border-input rounded-md bg-background"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveName(t)
                            if (e.key === 'Escape') setEditing(null)
                          }}
                        />
                        <button
                          onClick={() => saveName(t)}
                          disabled={busy === t.id}
                          className="p-1 text-primary hover:bg-accent rounded"
                          title="Guardar"
                        >
                          <Check size={15} />
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="p-1 text-muted-foreground hover:bg-accent rounded"
                          title="Cancelar"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => toggleMembers(t)}
                          className={`text-sm font-medium truncate hover:underline text-left ${t.is_archived ? 'text-muted-foreground/60 italic' : 'text-foreground'}`}
                        >
                          {t.name}
                        </button>
                        {t.is_archived && (
                          <span className="flex-shrink-0 text-[10px] font-normal px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            Inactivo
                          </span>
                        )}
                        <button
                          onClick={() => startEdit(t)}
                          className="p-0.5 text-muted-foreground hover:text-foreground"
                          title="Renombrar"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t.member_count} {t.member_count === 1 ? 'miembro' : 'miembros'} · /{t.slug}
                    </p>
                  </div>

                  <select
                    value={t.space_id ?? ''}
                    onChange={(e) => changeDepartment(t, e.target.value)}
                    disabled={busy === t.id}
                    title="Departamento del equipo"
                    className="px-2 py-1 text-sm border border-input rounded-lg bg-background disabled:opacity-50 max-w-[10rem]"
                  >
                    <option value="">Sin departamento</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}{d.is_restricted ? ' (restringido)' : ''}
                      </option>
                    ))}
                  </select>

                  <select
                    value={t.methodology}
                    onChange={(e) => changeMethodology(t, e.target.value)}
                    disabled={busy === t.id}
                    className="px-2 py-1 text-sm border border-input rounded-lg bg-background capitalize disabled:opacity-50"
                  >
                    <option value="scrum">Scrum</option>
                    <option value="kanban">Kanban</option>
                  </select>

                  <button
                    onClick={() => toggleArchived(t)}
                    disabled={busy === t.id}
                    title={t.is_archived ? 'Activar equipo' : 'Desactivar equipo'}
                    aria-label={t.is_archived ? 'Activar equipo' : 'Desactivar equipo'}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded disabled:opacity-40"
                  >
                    {t.is_archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                    {t.is_archived ? 'Activar' : 'Desactivar'}
                  </button>

                  <button
                    onClick={() => removeTeam(t)}
                    disabled={busy === t.id}
                    className="text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded disabled:opacity-40"
                  >
                    Eliminar
                  </button>
                </div>

                {isOpen && (
                  <div className="px-4 pb-4 pl-14 bg-muted/20 border-t border-border">
                    {loadingMembers === t.id ? (
                      <div className="space-y-2 pt-3" aria-label="Cargando miembros">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className="flex items-center gap-2.5">
                            <Skeleton className="h-7 w-7 rounded-full flex-shrink-0" />
                            <Skeleton className="h-3.5 w-44" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2 pt-3">
                        {members.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Este equipo no tiene miembros.</p>
                        ) : (
                          members.map((m) => (
                            <div key={m.profile_id} className="flex items-center gap-2.5">
                              <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden bg-muted">
                                {m.avatar_url ? (
                                  <Image
                                    src={m.avatar_url}
                                    alt={m.display_name}
                                    width={28}
                                    height={28}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span className="flex items-center justify-center w-full h-full text-[10px] font-medium text-muted-foreground">
                                    {getInitials(m.display_name)}
                                  </span>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-foreground truncate">{m.display_name}</p>
                                <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                              </div>
                              <select
                                value={m.role === 'admin' ? 'admin' : 'member'}
                                onChange={(e) => changeMemberRole(t, m.profile_id, e.target.value as 'admin' | 'member')}
                                disabled={busy === t.id}
                                className="px-2 py-1 text-xs border border-input rounded-lg bg-background capitalize disabled:opacity-50"
                              >
                                <option value="admin">Admin</option>
                                <option value="member">Miembro</option>
                              </select>
                              <button
                                onClick={() => removeMember(t, m)}
                                disabled={busy === t.id}
                                className="text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded disabled:opacity-40"
                              >
                                Quitar
                              </button>
                            </div>
                          ))
                        )}

                        {/* Agregar miembro del pool del workspace */}
                        <div className="flex items-center gap-2 pt-2">
                          <UserPlus size={14} className="text-muted-foreground flex-shrink-0" />
                          <select
                            value={addSelection[t.id] ?? ''}
                            onChange={(e) => setAddSelection((prev) => ({ ...prev, [t.id]: e.target.value }))}
                            disabled={busy === t.id || pool.length === 0}
                            className="flex-1 px-2 py-1 text-sm border border-input rounded-lg bg-background disabled:opacity-50"
                          >
                            <option value="">
                              {pool.length === 0 ? 'Todos ya están en el equipo' : 'Agregar persona…'}
                            </option>
                            {pool.map((p) => (
                              <option key={p.profile_id} value={p.profile_id}>
                                {p.display_name} ({p.email})
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => addMember(t)}
                            disabled={busy === t.id || !addSelection[t.id]}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary text-primary-foreground text-xs rounded-lg hover:bg-primary/90 disabled:opacity-40"
                          >
                            <Plus size={13} /> Agregar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {teams.length} {teams.length === 1 ? 'equipo' : 'equipos'} en el workspace.
        </p>
        <Link
          href={`/w/${workspaceSlug}/teams/new`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90"
        >
          <Plus size={14} /> Nuevo equipo
        </Link>
      </div>

      {teams.length === 0 ? (
        <EmptyState
          icon={<UsersRound className="h-5 w-5" />}
          title="Aún no hay equipos"
          description="Crea un equipo para agrupar personas por proyecto o metodología de trabajo."
          action={
            <Link
              href={`/w/${workspaceSlug}/teams/new`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90"
            >
              <Plus size={14} /> Nuevo equipo
            </Link>
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-1.5 px-1 pb-1.5">
                {g.hasDept ? (
                  g.is_restricted ? (
                    <Lock size={13} className="text-muted-foreground flex-shrink-0" />
                  ) : (
                    <Building2 size={13} className="text-muted-foreground flex-shrink-0" />
                  )
                ) : (
                  <UsersRound size={13} className="text-muted-foreground/70 flex-shrink-0" />
                )}
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </h3>
                {g.is_restricted && (
                  <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                    Aislado
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground/60">
                  · {g.items.length}
                </span>
              </div>
              <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
                {g.items.map((t) => renderTeamRow(t))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
