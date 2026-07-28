'use client'

/**
 * ManageProject: panel del lider (charter + postulaciones + equipo).
 *
 * Todo optimista/ligero: al aceptar o rechazar una postulacion, refresca via
 * router.refresh() para reflejar el nuevo estado (miembro agregado, etc.).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, X, Crown, Users, ScrollText, Loader2, Unlock, Lock } from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'

export type Charter = {
  id: string
  name: string
  icon: string | null
  scope: string | null
  rules: string | null
  deliverables: string | null
  open_for_applications: boolean
  application_deadline: string | null
  max_members: number | null
}

export type Application = {
  id: string
  pitch: string
  role_desired: string | null
  status: string
  created_at: string
  applicant: { id: string; display_name: string | null; avatar_url: string | null; email: string | null } | null
}

export type Member = {
  profile_id: string
  role: string
  title: string | null
  joined_at: string
  profile: { id: string; display_name: string | null; avatar_url: string | null } | null
}

const INPUT = 'w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

export function ManageProject({ charter, applications, members, workspaceSlug }: {
  charter: Charter
  applications: Application[]
  members: Member[]
  workspaceSlug: string
}) {
  const t = useT()
  const pending = applications.filter(a => a.status === 'pending')

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
          <ScrollText className="w-5 h-5 text-muted-foreground" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{charter.name}</h1>
          <p className="text-sm text-muted-foreground">{t('manage.subtitle')}</p>
        </div>
      </div>

      <CharterEditor charter={charter} />
      <ApplicationsPanel applications={pending} />
      <TeamPanel members={members} workspaceSlug={workspaceSlug} />
    </div>
  )
}

function CharterEditor({ charter }: { charter: Charter }) {
  const router = useRouter()
  const t = useT()
  const [scope, setScope] = useState(charter.scope ?? '')
  const [rules, setRules] = useState(charter.rules ?? '')
  const [deliverables, setDeliverables] = useState(charter.deliverables ?? '')
  const [maxMembers, setMaxMembers] = useState(charter.max_members?.toString() ?? '')
  const [deadline, setDeadline] = useState(charter.application_deadline ? charter.application_deadline.slice(0, 10) : '')
  const [open, setOpen] = useState(charter.open_for_applications)
  const [loading, setLoading] = useState(false)

  const save = async () => {
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        scope: scope.trim() || null,
        rules: rules.trim() || null,
        deliverables: deliverables.trim() || null,
        open_for_applications: open,
        max_members: maxMembers ? parseInt(maxMembers, 10) : null,
        application_deadline: deadline ? new Date(deadline + 'T23:59:59Z').toISOString() : null,
      }
      const res = await fetch(`/api/projects/${charter.id}/charter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? t('form.saveError'))
      toast.success(t('manage.charterSaved'))
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <ScrollText className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{t('manage.charterTitle')}</h2>
      </div>

      <div className="space-y-4">
        <Field label={t('manage.scope')} hint={t('manage.scopeHint')}>
          <textarea value={scope} onChange={e => setScope(e.target.value)} rows={3} maxLength={4000} disabled={loading} className={`${INPUT} resize-none`} placeholder={t('manage.scopePlaceholder')} />
        </Field>
        <Field label={t('manage.rules')} hint={t('manage.rulesHint')}>
          <textarea value={rules} onChange={e => setRules(e.target.value)} rows={3} maxLength={4000} disabled={loading} className={`${INPUT} resize-none`} placeholder={t('manage.rulesPlaceholder')} />
        </Field>
        <Field label={t('manage.deliverables')} hint={t('manage.deliverablesHint')}>
          <textarea value={deliverables} onChange={e => setDeliverables(e.target.value)} rows={3} maxLength={4000} disabled={loading} className={`${INPUT} resize-none`} placeholder={t('manage.deliverablesPlaceholder')} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('manage.maxMembers')} hint={t('manage.optionalDot')}>
            <input type="number" min={1} max={200} value={maxMembers} onChange={e => setMaxMembers(e.target.value)} disabled={loading} className={INPUT} placeholder={t('manage.noLimit')} />
          </Field>
          <Field label={t('manage.deadline')} hint={t('manage.optionalDot')}>
            <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} disabled={loading} className={INPUT} />
          </Field>
        </div>

        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          disabled={loading}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
            open ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : 'bg-muted text-muted-foreground border-border'
          }`}
        >
          {open ? <><Unlock className="w-4 h-4" /> {t('manage.openApps')}</> : <><Lock className="w-4 h-4" /> {t('manage.closedApps')}</>}
        </button>

        <div className="flex justify-end">
          <button onClick={save} disabled={loading} className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('common.saving')}</> : t('manage.saveCharter')}
          </button>
        </div>
      </div>
    </section>
  )
}

function ApplicationsPanel({ applications }: { applications: Application[] }) {
  const router = useRouter()
  const t = useT()
  const [busyId, setBusyId] = useState<string | null>(null)

  const decide = async (appId: string, status: 'accepted' | 'rejected') => {
    setBusyId(appId)
    try {
      const res = await fetch(`/api/applications/${appId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? t('form.error'))
      toast.success(status === 'accepted' ? t('manage.appAccepted') : t('manage.appRejected'))
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{t('manage.pendingApps')}</h2>
        <span className="text-xs text-muted-foreground">{applications.length}</span>
      </div>

      {applications.length === 0 ? (
        <p className="text-sm text-muted-foreground bg-card border border-border rounded-xl p-5">{t('manage.noPendingApps')}</p>
      ) : (
        <div className="space-y-3">
          {applications.map(app => (
            <div key={app.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{app.applicant?.display_name ?? app.applicant?.email ?? t('manage.applicant')}</p>
                  {app.role_desired && <p className="text-xs text-muted-foreground">{t('form.roleLabel')} {app.role_desired}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => decide(app.id, 'accepted')}
                    disabled={busyId === app.id}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" /> {t('manage.accept')}
                  </button>
                  <button
                    onClick={() => decide(app.id, 'rejected')}
                    disabled={busyId === app.id}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" /> {t('manage.reject')}
                  </button>
                </div>
              </div>
              <p className="text-sm text-foreground/80 mt-2 whitespace-pre-wrap">{app.pitch}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function TeamPanel({ members, workspaceSlug }: { members: Member[]; workspaceSlug: string }) {
  const t = useT()
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Crown className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{t('manage.currentTeam')}</h2>
        <span className="text-xs text-muted-foreground">{members.length}</span>
      </div>
      <div className="bg-card border border-border rounded-xl divide-y divide-border">
        {members.map(m => (
          <Link
            key={m.profile_id}
            href={`/w/${workspaceSlug}/cv/${m.profile_id}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
          >
            <Avatar url={m.profile?.avatar_url} name={m.profile?.display_name} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{m.profile?.display_name ?? t('manage.member')}</p>
              {m.title && <p className="text-xs text-muted-foreground truncate">{m.title}</p>}
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{m.role}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {hint && <p className="text-[11px] text-muted-foreground -mt-1">{hint}</p>}
      {children}
    </div>
  )
}

function Avatar({ url, name }: { url: string | null | undefined; name: string | null | undefined }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name ?? ''} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
  }
  return (
    <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground flex-shrink-0">
      {(name ?? '?').charAt(0).toUpperCase()}
    </span>
  )
}
