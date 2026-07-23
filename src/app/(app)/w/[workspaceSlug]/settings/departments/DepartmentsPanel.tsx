'use client'

/**
 * DepartmentsPanel, crea, renombra, restringe, archiva y elimina departamentos (spaces).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import { FolderKanban, Plus, Pencil, Check, X, Lock, Globe, Users, UserPlus } from 'lucide-react'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'

interface Space {
  id: string
  name: string
  description: string | null
  is_restricted: boolean
  is_archived: boolean
  member_count: number
}

interface WorkspaceMember {
  profile_id: string
  display_name: string
  email: string
  avatar_url: string | null
}

interface SpaceMember {
  profile_id: string
  role: string
  display_name: string
  email: string
  avatar_url: string | null
}

export function DepartmentsPanel({
  workspaceId,
  initialSpaces,
  workspaceMembers,
}: {
  workspaceId: string
  initialSpaces: Space[]
  workspaceMembers: WorkspaceMember[]
}) {
  const router = useRouter()
  const [spaces, setSpaces] = useState<Space[]>(initialSpaces)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  // Gestión de miembros por departamento
  const [membersOpen, setMembersOpen] = useState<string | null>(null)
  const [memberList, setMemberList] = useState<SpaceMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [addingId, setAddingId] = useState('')

  async function toggleMembers(s: Space) {
    if (membersOpen === s.id) { setMembersOpen(null); return }
    setMembersOpen(s.id)
    setMemberList([])
    setAddingId('')
    setLoadingMembers(true)
    try {
      const res = await fetch(`/api/spaces/${s.id}/members`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar miembros')
      setMemberList(data.members ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar miembros')
      setMembersOpen(null)
    } finally {
      setLoadingMembers(false)
    }
  }

  function bumpCount(spaceId: string, delta: number) {
    setSpaces((prev) => prev.map((x) => (x.id === spaceId ? { ...x, member_count: Math.max(0, x.member_count + delta) } : x)))
  }

  async function addMember(spaceId: string, profileId: string) {
    if (!profileId) return
    setLoadingMembers(true)
    try {
      const res = await fetch(`/api/spaces/${spaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al agregar')
      const wm = workspaceMembers.find((m) => m.profile_id === profileId)
      if (wm) setMemberList((prev) => [...prev, { ...wm, role: 'member' }])
      setAddingId('')
      bumpCount(spaceId, 1)
      toast.success('Asignado al departamento')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al agregar')
    } finally {
      setLoadingMembers(false)
    }
  }

  async function removeMember(spaceId: string, profileId: string) {
    setLoadingMembers(true)
    try {
      const res = await fetch(`/api/spaces/${spaceId}/members/${profileId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'Error al quitar')
      }
      setMemberList((prev) => prev.filter((m) => m.profile_id !== profileId))
      bumpCount(spaceId, -1)
      toast.success('Quitado del departamento')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al quitar')
    } finally {
      setLoadingMembers(false)
    }
  }

  // Crear
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRestricted, setNewRestricted] = useState(false)
  const [creating, setCreating] = useState(false)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (newName.trim().length < 1) return
    setCreating(true)
    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: newName.trim(),
          is_restricted: newRestricted,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al crear')
      toast.success('Departamento creado')
      setSpaces((prev) =>
        [...prev, { id: data.id, name: data.name, description: data.description ?? null, is_restricted: data.is_restricted, is_archived: data.is_archived, member_count: 1 }].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      )
      setNewName('')
      setNewRestricted(false)
      setShowCreate(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setCreating(false)
    }
  }

  async function patch(s: Space, body: Record<string, unknown>, okMsg: string) {
    setBusy(s.id)
    try {
      const res = await fetch(`/api/spaces/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al guardar')
      toast.success(okMsg)
      setSpaces((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...body } as Space : x)))
      setEditing(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  function saveName(s: Space) {
    const name = draftName.trim()
    if (name.length < 1) {
      toast.error('El nombre no puede estar vacío')
      return
    }
    patch(s, { name }, 'Departamento actualizado')
  }

  async function removeSpace(s: Space) {
    if (
      !(await confirmDialog({
        message: `¿Eliminar el departamento ${s.name}? Las notas asociadas quedarán sin departamento.`,
        destructive: true,
        confirmLabel: 'Eliminar',
      }))
    )
      return
    setBusy(s.id)
    try {
      const res = await fetch(`/api/spaces/${s.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Error al eliminar')
      }
      toast.success('Departamento eliminado')
      setSpaces((prev) => prev.filter((x) => x.id !== s.id))
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {spaces.length} {spaces.length === 1 ? 'departamento' : 'departamentos'}. Los restringidos solo son visibles para sus miembros y admins.
        </p>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90"
          >
            <Plus size={14} /> Nuevo
          </button>
        )}
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Nuevo departamento</h3>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={120}
            placeholder="Ej. Marketing, Finanzas, Legal"
            className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background"
            disabled={creating}
          />
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={newRestricted}
              onChange={(e) => setNewRestricted(e.target.checked)}
              disabled={creating}
              className="rounded border-input"
            />
            Restringido (visible solo para sus miembros y admins)
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={creating || newName.trim().length < 1}
              className="px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {creating ? 'Creando...' : 'Crear'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              disabled={creating}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {spaces.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="h-5 w-5" />}
          title="Aún no hay departamentos"
          description="Crea un departamento para organizar notas, tareas y equipos por área."
          action={
            !showCreate ? (
              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90"
              >
                <Plus size={14} /> Nuevo departamento
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          {spaces.map((s) => (
            <div key={s.id}>
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <FolderKanban size={15} className="text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                {editing === s.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      maxLength={120}
                      className="flex-1 px-2 py-1 text-sm border border-input rounded-md bg-background"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveName(s)
                        if (e.key === 'Escape') setEditing(null)
                      }}
                    />
                    <button
                      onClick={() => saveName(s)}
                      disabled={busy === s.id}
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
                    <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                    <button
                      onClick={() => { setEditing(s.id); setDraftName(s.name) }}
                      className="p-0.5 text-muted-foreground hover:text-foreground"
                      title="Renombrar"
                    >
                      <Pencil size={12} />
                    </button>
                    {s.is_restricted ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        <Lock className="h-2.5 w-2.5" /> Restringido
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        <Globe className="h-2.5 w-2.5" /> Público
                      </span>
                    )}
                    {s.is_archived && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        Archivado
                      </span>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {s.member_count} {s.member_count === 1 ? 'miembro' : 'miembros'}
                </p>
              </div>

              <button
                onClick={() => toggleMembers(s)}
                disabled={busy === s.id}
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded disabled:opacity-40 ${
                  membersOpen === s.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Users size={13} /> Miembros
              </button>

              <button
                onClick={() => patch(s, { is_restricted: !s.is_restricted }, s.is_restricted ? 'Ahora es público' : 'Ahora es restringido')}
                disabled={busy === s.id}
                className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground rounded disabled:opacity-40"
              >
                {s.is_restricted ? 'Hacer público' : 'Restringir'}
              </button>

              <button
                onClick={() => patch(s, { is_archived: !s.is_archived }, s.is_archived ? 'Restaurado' : 'Archivado')}
                disabled={busy === s.id}
                className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground rounded disabled:opacity-40"
              >
                {s.is_archived ? 'Restaurar' : 'Archivar'}
              </button>

              <button
                onClick={() => removeSpace(s)}
                disabled={busy === s.id}
                className="text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded disabled:opacity-40"
              >
                Eliminar
              </button>
            </div>

            {membersOpen === s.id && (
              <div className="px-4 pb-4 pt-1 bg-muted/20 border-t border-border">
                {/* Selector para asignar */}
                {(() => {
                  const assignedIds = new Set(memberList.map((m) => m.profile_id))
                  const available = workspaceMembers.filter((m) => !assignedIds.has(m.profile_id))
                  return (
                    <div className="flex items-center gap-2 py-3">
                      <UserPlus size={15} className="text-muted-foreground flex-shrink-0" />
                      <select
                        value={addingId}
                        onChange={(e) => setAddingId(e.target.value)}
                        disabled={loadingMembers || available.length === 0}
                        className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-input rounded-lg bg-background disabled:opacity-50"
                      >
                        <option value="">
                          {available.length === 0 ? 'Todos ya están asignados' : 'Elegir persona para asignar...'}
                        </option>
                        {available.map((m) => (
                          <option key={m.profile_id} value={m.profile_id}>
                            {m.display_name} {m.email ? `(${m.email})` : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => addMember(s.id, addingId)}
                        disabled={loadingMembers || !addingId}
                        className="px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50 flex-shrink-0"
                      >
                        Asignar
                      </button>
                    </div>
                  )
                })()}

                {/* Lista de asignados */}
                {loadingMembers && memberList.length === 0 ? (
                  <ul className="space-y-1" aria-label="Cargando miembros">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <li key={i} className="flex items-center gap-2 py-1">
                        <Skeleton className="h-6 w-6 rounded-full flex-shrink-0" />
                        <Skeleton className="h-3.5 w-40" />
                      </li>
                    ))}
                  </ul>
                ) : memberList.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    Nadie asignado aún. Usa el selector de arriba para agregar a tu equipo.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {memberList.map((m) => (
                      <li key={m.profile_id} className="flex items-center gap-2 py-1">
                        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground flex-shrink-0">
                          {m.display_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-foreground">{m.display_name}</span>
                          {m.role === 'owner' && (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Owner</span>
                          )}
                        </div>
                        <button
                          onClick={() => removeMember(s.id, m.profile_id)}
                          disabled={loadingMembers}
                          className="text-xs px-2 py-0.5 text-muted-foreground hover:text-destructive rounded disabled:opacity-40"
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
