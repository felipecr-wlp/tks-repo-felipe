'use client'

/**
 * InvitesPanel, UI para generar y revocar códigos de invitación de un workspace.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import { Lock, Ticket } from 'lucide-react'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { useT } from '@/lib/i18n/LanguageProvider'

interface Invite {
  id: string
  code: string
  role: string
  max_uses: number | null
  uses_count: number
  expires_at: string | null
  revoked_at: string | null
  created_at: string
  has_password: boolean
}

interface InvitesPanelProps {
  workspaceId: string
  workspaceSlug: string
}

export function InvitesPanel({ workspaceId, workspaceSlug }: InvitesPanelProps) {
  const t = useT()
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  // Form state
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'manager' | 'member' | 'viewer'>('member')
  const [maxUses, setMaxUses] = useState<string>('')
  const [expiresInDays, setExpiresInDays] = useState<string>('30')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')
      setInvites(data.invites ?? [])
    } catch (err) {
      setError(true)
      toast.error(err instanceof Error ? err.message : t('invp.loadError'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [workspaceId])  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: password || null,
          role,
          max_uses: maxUses ? parseInt(maxUses, 10) : null,
          expires_in_days: expiresInDays ? parseInt(expiresInDays, 10) : null,
          email: email.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('invp.createError'))
      toast.success(email.trim() ? t('invp.createdSent') : t('invp.created'))
      setPassword('')
      setMaxUses('')
      setEmail('')
      setShowCreate(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevoke(inviteId: string) {
    if (!(await confirmDialog({ message: t('invp.revokeConfirm'), destructive: true, confirmLabel: t('invp.revoke') }))) return
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites/${inviteId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? t('invp.revokeError'))
      }
      toast.success(t('invp.revoked'))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
    }
  }

  function copyLink(code: string) {
    const url = `${window.location.origin}/join/${code}`
    navigator.clipboard.writeText(url)
    toast.success(t('invp.linkCopied'))
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code)
    toast.success(t('invp.codeCopied'))
  }

  return (
    <div className="space-y-4">
      {/* Crear nuevo */}
      {showCreate ? (
        <form onSubmit={handleCreate} className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">{t('invp.newInvite')}</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="role" className="text-xs font-medium text-foreground">{t('invp.roleAssigned')}</label>
              <select
                id="role"
                value={role}
                onChange={e => setRole(e.target.value as typeof role)}
                className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background"
                disabled={submitting}
              >
                <option value="viewer">{t('role.viewer')}</option>
                <option value="member">{t('role.member')}</option>
                <option value="manager">{t('role.manager')}</option>
                <option value="admin">{t('role.admin')}</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="expires" className="text-xs font-medium text-foreground">{t('invp.expiresInDays')}</label>
              <input
                id="expires"
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={e => setExpiresInDays(e.target.value)}
                placeholder="30"
                className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="maxUses" className="text-xs font-medium text-foreground">{t('invp.maxUses')}</label>
              <input
                id="maxUses"
                type="number"
                min={1}
                value={maxUses}
                onChange={e => setMaxUses(e.target.value)}
                placeholder={t('invp.noLimit')}
                className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-foreground">{t('invp.passwordOptional')}</label>
              <input
                id="password"
                type="text"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('invp.noPassword')}
                className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="inviteEmail" className="text-xs font-medium text-foreground">
              {t('invp.sendByEmail')}
            </label>
            <input
              id="inviteEmail"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="persona@pavific.com"
              className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background"
              disabled={submitting}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('invp.emailHint')}
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? t('invp.creating') : t('invp.createInvite')}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              disabled={submitting}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90"
        >
          {t('invp.generate')}
        </button>
      )}

      {/* Lista */}
      {loading ? (
        <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-6 w-16 rounded" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState onRetry={load} retrying={loading} />
      ) : invites.length === 0 ? (
        <EmptyState
          icon={<Ticket className="h-5 w-5" />}
          title={t('invp.emptyTitle')}
          description={t('invp.emptyDesc')}
          action={
            <button
              onClick={() => setShowCreate(true)}
              className="px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90"
            >
              + Generar invite
            </button>
          }
        />
      ) : (
        <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          {invites.map(inv => {
            const isRevoked = inv.revoked_at != null
            const isExpired = inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()
            const isUsedUp = inv.max_uses != null && inv.uses_count >= inv.max_uses
            const isActive = !isRevoked && !isExpired && !isUsedUp

            return (
              <div key={inv.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono text-foreground truncate">{inv.code}</code>
                    {!isActive && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {isRevoked ? t('invp.statusRevoked') : isExpired ? t('invp.statusExpired') : t('invp.statusUsedUp')}
                      </span>
                    )}
                    {inv.has_password && isActive && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        <Lock className="h-2.5 w-2.5" /> Password
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('invp.rolePrefix')} <span className="text-foreground">{t(`role.${inv.role}`)}</span> ·{' '}
                    {t('invp.usesPrefix')} {inv.uses_count}{inv.max_uses ? `/${inv.max_uses}` : ''} ·{' '}
                    {inv.expires_at
                      ? `${t('invp.expiresPrefix')} ${new Date(inv.expires_at).toLocaleDateString()}`
                      : t('invp.noExpire')}
                  </p>
                </div>

                {isActive && (
                  <>
                    <button
                      onClick={() => copyCode(inv.code)}
                      className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground"
                      title={t('invp.copyCode')}
                    >
                      {t('invp.code')}
                    </button>
                    <button
                      onClick={() => copyLink(inv.code)}
                      className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground"
                      title={t('invp.copyLink')}
                    >
                      {t('invp.link')}
                    </button>
                    <button
                      onClick={() => handleRevoke(inv.id)}
                      className="text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded"
                    >
                      {t('invp.revoke')}
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground pt-2">
        {t('invp.wsSlug')} <code>{workspaceSlug}</code>
      </p>
    </div>
  )
}
