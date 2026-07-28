'use client'

/**
 * MembersPanel, lista miembros del workspace, cambia su rol y los quita.
 */
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { Users } from 'lucide-react'
import { confirmDialog } from '@/components/ConfirmDialog'
import { getInitials } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { useT } from '@/lib/i18n/LanguageProvider'

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
  const t = useT()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      setMembers(data.members ?? [])
    } catch (err) {
      setError(true)
      toast.error(err instanceof Error ? err.message : t('memp.loadError'))
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
      if (!res.ok) throw new Error(data.error ?? t('memp.updateError'))
      toast.success(t('memp.roleUpdated'))
      setMembers((prev) => prev.map((m) => (m.profile_id === profileId ? { ...m, role } : m)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
      // Reconciliar el rol optimista con el servidor sin parpadear el skeleton.
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/members`)
        const data = await res.json()
        if (res.ok) setMembers(data.members ?? [])
      } catch {
        /* si falla, dejamos el estado actual y el toast ya avisó */
      }
    } finally {
      setBusy(null)
    }
  }

  async function removeMember(m: Member) {
    if (
      !(await confirmDialog({
        message: `${t('memp.removeConfirmPrefix')} ${m.display_name} ${t('memp.removeConfirmSuffix')}`,
        destructive: true,
        confirmLabel: t('memp.remove'),
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
        throw new Error(data.error ?? t('memp.removeError'))
      }
      toast.success(t('memp.removed'))
      setMembers((prev) => prev.filter((x) => x.profile_id !== m.profile_id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-40" />
        <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-7 w-24 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) return <ErrorState onRetry={load} retrying={loading} />

  if (members.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-5 w-5" />}
        title={t('memp.emptyTitle')}
        description={t('memp.emptyDesc')}
      />
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {members.length} {members.length === 1 ? t('memp.countOne') : t('memp.countMany')} {t('memp.countSuffix')}
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
                  {isSelf && <span className="text-xs text-muted-foreground font-normal">{t('memp.you')}</span>}
                </p>
                <p className="text-xs text-muted-foreground truncate">{m.email}</p>
              </div>

              <select
                value={m.role}
                onChange={(e) => changeRole(m.profile_id, e.target.value as Role)}
                disabled={busy === m.profile_id}
                className="px-2 py-1 text-sm border border-input rounded-lg bg-background disabled:opacity-50"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}`)}
                  </option>
                ))}
              </select>

              <button
                onClick={() => removeMember(m)}
                disabled={busy === m.profile_id || isSelf}
                title={isSelf ? t('memp.cannotRemoveSelf') : t('memp.removeFromWs')}
                className="text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {t('memp.remove')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
