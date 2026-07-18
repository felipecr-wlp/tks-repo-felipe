'use client'

/**
 * MembersPanel, lista miembros del workspace, cambia su rol y los quita.
 */
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import { getInitials } from '@/lib/utils'

const ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'] as const
type Role = (typeof ROLES)[number]

interface Member {
  profile_id: string
  role: string
  created_at: string
  display_name: string
  email: string
  avatar_url: string | null
}

export function MembersPanel({
  workspaceId,
  currentUserId,
}: {
  workspaceId: string
  currentUserId: string
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      setMembers(data.members ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function changeRole(profileId: string, role: Role) {
    setBusy(profileId)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al actualizar')
      toast.success('Rol actualizado')
      setMembers((prev) => prev.map((m) => (m.profile_id === profileId ? { ...m, role } : m)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function removeMember(m: Member) {
    if (
      !(await confirmDialog({
        message: `¿Quitar a ${m.display_name} del workspace?`,
        destructive: true,
        confirmLabel: 'Quitar',
      }))
    )
      return
    setBusy(m.profile_id)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${m.profile_id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Error al quitar')
      }
      toast.success('Miembro quitado')
      setMembers((prev) => prev.filter((x) => x.profile_id !== m.profile_id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {members.length} {members.length === 1 ? 'miembro' : 'miembros'} en el workspace.
      </p>

      <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
        {members.map((m) => {
          const isSelf = m.profile_id === currentUserId
          return (
            <div key={m.profile_id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden bg-muted">
                {m.avatar_url ? (
                  <Image
                    src={m.avatar_url}
                    alt={m.display_name}
                    width={32}
                    height={32}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="flex items-center justify-center w-full h-full text-xs font-medium text-muted-foreground">
                    {getInitials(m.display_name)}
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {m.display_name}
                  {isSelf && <span className="text-xs text-muted-foreground font-normal"> (tú)</span>}
                </p>
                <p className="text-xs text-muted-foreground truncate">{m.email}</p>
              </div>

              <select
                value={m.role}
                onChange={(e) => changeRole(m.profile_id, e.target.value as Role)}
                disabled={busy === m.profile_id}
                className="px-2 py-1 text-sm border border-input rounded-lg bg-background capitalize disabled:opacity-50"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r} className="capitalize">
                    {r}
                  </option>
                ))}
              </select>

              <button
                onClick={() => removeMember(m)}
                disabled={busy === m.profile_id || isSelf}
                title={isSelf ? 'No puedes quitarte a ti mismo' : 'Quitar del workspace'}
                className="text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Quitar
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
