'use client'

/**
 * ProjectsBoard: tablero interactivo del marketplace interno.
 *
 * Tres vistas en un segmento: Abiertos (postularse), Mis proyectos (progreso +
 * completar + calificar) y Pendientes (solo admins, aprobar/rechazar). Todo con
 * iconos lucide, sin emojis. Las acciones llaman a las APIs y refrescan la vista.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  FolderKanban, Plus, Compass, CheckCircle2, Clock, ShieldCheck, X, Loader2,
  Star, Crown, ChevronRight, Check, Ban,
} from 'lucide-react'
import { MarketplaceBoard, type MarketProject } from './MarketplaceBoard'
import { useT } from '@/lib/i18n/LanguageProvider'

export type { MarketProject }

export type MyProject = {
  id: string
  name: string
  icon: string | null
  description: string | null
  status: string
  approval_status: string
  my_role: string
  pct: number
  total: number
  done: number
  is_lead: boolean
  can_complete: boolean
}

export type PendingProject = {
  id: string
  name: string
  icon: string | null
  description: string | null
  created_at: string
  proposer_name: string | null
  proposer_avatar: string | null
}

type Tab = 'open' | 'mine' | 'pending'

const INPUT = 'w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

export function ProjectsBoard({
  workspaceName, workspaceSlug, userId, isAdmin, openProjects, myProjects, pendingProjects,
}: {
  workspaceName: string
  workspaceSlug: string
  userId: string
  isAdmin: boolean
  openProjects: MarketProject[]
  myProjects: MyProject[]
  pendingProjects: PendingProject[]
}) {
  const tr = useT()
  const [tab, setTab] = useState<Tab>('open')
  const [creating, setCreating] = useState(false)
  const [reviewProject, setReviewProject] = useState<MyProject | null>(null)

  const tabs: { key: Tab; label: string; icon: typeof Compass; count: number; show: boolean }[] = [
    { key: 'open', label: tr('proj.tabOpen'), icon: Compass, count: openProjects.length, show: true },
    { key: 'mine', label: tr('proj.tabMine'), icon: FolderKanban, count: myProjects.length, show: true },
    { key: 'pending', label: tr('proj.tabPending'), icon: ShieldCheck, count: pendingProjects.length, show: isAdmin },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{tr('proj.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {workspaceName} · {tr('proj.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href={`/w/${workspaceSlug}/cv/${userId}`}
            className="px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors"
          >
            {tr('proj.myCv')}
          </Link>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> {tr('proj.createProject')}
          </button>
        </div>
      </div>

      {/* Segmento de vistas */}
      <div className="inline-flex items-center gap-1 p-1 mb-6 rounded-xl bg-muted/60 border border-border">
        {tabs.filter(t => t.show).map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                active ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              <span className={`ml-0.5 min-w-[18px] px-1.5 py-0.5 rounded-full text-[10px] leading-none ${
                active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}>
                {t.count}
              </span>
            </button>
          )
        })}
      </div>

      {tab === 'open' && (
        <MarketplaceBoard projects={openProjects} workspaceSlug={workspaceSlug} />
      )}

      {tab === 'mine' && (
        <MyProjectsPanel
          projects={myProjects}
          workspaceSlug={workspaceSlug}
          onReview={setReviewProject}
        />
      )}

      {tab === 'pending' && isAdmin && (
        <PendingPanel projects={pendingProjects} />
      )}

      {creating && (
        <CreateProjectModal workspaceSlug={workspaceSlug} onClose={() => setCreating(false)} />
      )}

      {reviewProject && (
        <ReviewModal project={reviewProject} onClose={() => setReviewProject(null)} />
      )}
    </div>
  )
}

// ─── Mis proyectos ──────────────────────────────────────────────────────────────
function MyProjectsPanel({ projects, workspaceSlug, onReview }: {
  projects: MyProject[]
  workspaceSlug: string
  onReview: (p: MyProject) => void
}) {
  const tr = useT()
  if (projects.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-border rounded-xl">
        <FolderKanban className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
        <h3 className="text-sm font-medium text-foreground mb-1">{tr('proj.myEmptyTitle')}</h3>
        <p className="text-sm text-muted-foreground">{tr('proj.myEmptyDesc')}</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {projects.map(p => (
        <MyProjectCard key={p.id} project={p} workspaceSlug={workspaceSlug} onReview={onReview} />
      ))}
    </div>
  )
}

function StatusBadge({ status, approval }: { status: string; approval: string }) {
  const tr = useT()
  if (approval === 'pending') {
    return <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600"><Clock className="w-3 h-3" /> {tr('proj.inReview')}</span>
  }
  if (status === 'completed') {
    return <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600"><CheckCircle2 className="w-3 h-3" /> {tr('proj.completed')}</span>
  }
  if (status === 'on_hold') {
    return <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{tr('proj.onHold')}</span>
  }
  return <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{tr('proj.active')}</span>
}

function MyProjectCard({ project: p, workspaceSlug, onReview }: {
  project: MyProject
  workspaceSlug: string
  onReview: (p: MyProject) => void
}) {
  const tr = useT()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const completed = p.status === 'completed'

  const complete = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${p.id}/complete`, { method: 'PATCH' })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? tr('proj.completeError'))
      toast.success(tr('proj.completedToast'))
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('common.unknownError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col hover:border-ring/40 transition-colors">
      <div className="flex items-start gap-3 mb-3">
        <span className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <FolderKanban className="w-5 h-5 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate">{p.name}</h3>
            {p.is_lead && <Crown className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={p.status} approval={p.approval_status} />
            <span className="text-[11px] text-muted-foreground capitalize">{p.my_role}</span>
          </div>
        </div>
      </div>

      {p.description && <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{p.description}</p>}

      {/* Progreso */}
      <div className="mb-4 mt-auto">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
          <span>{tr('proj.progress')}</span>
          <span className="font-medium text-foreground">{p.pct}% · {p.done}/{p.total} {tr('proj.tasksSuffix')}</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${completed ? 'bg-emerald-500' : 'bg-primary'}`}
            style={{ width: `${p.pct}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {completed ? (
          <button
            onClick={() => onReview(p)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Star className="w-3.5 h-3.5" /> {tr('proj.rateTeam')}
          </button>
        ) : p.can_complete ? (
          <button
            onClick={complete}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {tr('proj.markComplete')}
          </button>
        ) : (
          <span className="flex-1 text-center px-3 py-2 text-xs text-muted-foreground">
            {p.total === 0 ? tr('proj.noTasksYet') : `${tr('proj.tasksLeftPrefix')} ${p.total - p.done} ${tr('proj.tasksSuffix')}`}
          </span>
        )}

        {p.is_lead && (
          <Link
            href={`/w/${workspaceSlug}/projects/${p.id}`}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors"
          >
            {tr('proj.manage')}
          </Link>
        )}
      </div>
    </div>
  )
}

// ─── Pendientes (admin) ─────────────────────────────────────────────────────────
function PendingPanel({ projects }: { projects: PendingProject[] }) {
  const tr = useT()
  if (projects.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-border rounded-xl">
        <ShieldCheck className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
        <h3 className="text-sm font-medium text-foreground mb-1">{tr('proj.pendingEmptyTitle')}</h3>
        <p className="text-sm text-muted-foreground">{tr('proj.pendingEmptyDesc')}</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {projects.map(p => <PendingCard key={p.id} project={p} />)}
    </div>
  )
}

function PendingCard({ project: p }: { project: PendingProject }) {
  const tr = useT()
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(decision)
    try {
      const res = await fetch(`/api/projects/${p.id}/approval`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? tr('proj.error'))
      toast.success(decision === 'approve' ? tr('proj.approvedToast') : tr('proj.rejectedToast'))
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('common.unknownError'))
      setBusy(null)
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <FolderKanban className="w-5 h-5 text-muted-foreground" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
            <p className="text-xs text-muted-foreground">{tr('proj.proposedByPrefix')} {p.proposer_name ?? tr('proj.aMember')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => decide('approve')}
            disabled={busy !== null}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          >
            {busy === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {tr('proj.approve')}
          </button>
          <button
            onClick={() => decide('reject')}
            disabled={busy !== null}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
          >
            {busy === 'reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />} {tr('proj.reject')}
          </button>
        </div>
      </div>
      {p.description && <p className="text-sm text-foreground/80 mt-2 whitespace-pre-wrap">{p.description}</p>}
    </div>
  )
}

// ─── Crear proyecto ─────────────────────────────────────────────────────────────
function CreateProjectModal({ workspaceSlug, onClose }: { workspaceSlug: string; onClose: () => void }) {
  const tr = useT()
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState('')
  const [deliverables, setDeliverables] = useState('')
  const [maxMembers, setMaxMembers] = useState('')
  const [deadline, setDeadline] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (loading) return // evita doble submit
    if (name.trim().length < 2) {
      toast.error(tr('proj.nameMin'))
      return
    }
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        workspace_slug: workspaceSlug,
        name: name.trim(),
        description: description.trim() || null,
        scope: scope.trim() || null,
        deliverables: deliverables.trim() || null,
        max_members: maxMembers ? parseInt(maxMembers, 10) : null,
        application_deadline: deadline ? new Date(deadline + 'T23:59:59Z').toISOString() : null,
      }
      const res = await fetch('/api/marketplace/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? tr('proj.createError'))
      toast.success(result.pending
        ? tr('proj.sentForReview')
        : tr('proj.createdOpen'))
      onClose()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('common.unknownError'))
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-overlay w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <FolderKanban className="w-4 h-4 text-primary" />
          </span>
          <h2 className="text-lg font-semibold text-foreground">{tr('proj.createProject')}</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {tr('proj.createHint')}
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">{tr('proj.name')} <span className="text-destructive">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={80} disabled={loading} className={INPUT} placeholder={tr('proj.namePlaceholder')} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">{tr('proj.description')}</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={500} rows={2} disabled={loading} className={`${INPUT} resize-none`} placeholder={tr('proj.descPlaceholder')} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">{tr('proj.scope')}</label>
            <textarea value={scope} onChange={e => setScope(e.target.value)} maxLength={4000} rows={2} disabled={loading} className={`${INPUT} resize-none`} placeholder={tr('proj.scopePlaceholder')} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">{tr('proj.deliverables')}</label>
            <textarea value={deliverables} onChange={e => setDeliverables(e.target.value)} maxLength={4000} rows={2} disabled={loading} className={`${INPUT} resize-none`} placeholder={tr('proj.delivPlaceholder')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">{tr('proj.maxSlots')}</label>
              <input type="number" min={1} max={200} value={maxMembers} onChange={e => setMaxMembers(e.target.value)} disabled={loading} className={INPUT} placeholder={tr('proj.noLimit')} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">{tr('proj.deadline')}</label>
              <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} disabled={loading} className={INPUT} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-5">
          <button onClick={onClose} disabled={loading} className="flex-1 px-4 py-2.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
            {tr('common.cancel')}
          </button>
          <button onClick={submit} disabled={loading} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />{tr('proj.creating')}</> : tr('proj.createProject')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Calificar equipo ───────────────────────────────────────────────────────────
type Teammate = { id: string; display_name: string | null; avatar_url: string | null; reviewed: boolean }

function ReviewModal({ project, onClose }: { project: MyProject; onClose: () => void }) {
  const tr = useT()
  const router = useRouter()
  const [teammates, setTeammates] = useState<Teammate[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/reviews`)
        const result = await res.json()
        if (!res.ok) throw new Error(result.error ?? 'Error')
        if (alive) setTeammates(result.teammates ?? [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : tr('proj.reviewsLoadError'))
        if (alive) setTeammates([])
      }
    })()
    return () => { alive = false }
  }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const onRated = (id: string) => {
    setTeammates(prev => (prev ?? []).map(t => t.id === id ? { ...t, reviewed: true } : t))
    setOpenId(null)
    router.refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-overlay w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Star className="w-4 h-4 text-primary" />
            </span>
            <h2 className="text-lg font-semibold text-foreground">{tr('proj.rateTeam')}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {tr('proj.rateAnon')}
        </p>

        {teammates === null ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : teammates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{tr('proj.noTeammates')}</p>
        ) : (
          <div className="space-y-2">
            {teammates.map(t => (
              <div key={t.id} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setOpenId(openId === t.id ? null : (t.reviewed ? null : t.id))}
                  disabled={t.reviewed}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors disabled:opacity-70 disabled:cursor-default"
                >
                  <Avatar url={t.avatar_url} name={t.display_name} />
                  <span className="text-sm font-medium text-foreground flex-1 text-left truncate">{t.display_name ?? tr('proj.teammate')}</span>
                  {t.reviewed ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> {tr('proj.rated')}</span>
                  ) : (
                    <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${openId === t.id ? 'rotate-90' : ''}`} />
                  )}
                </button>
                {openId === t.id && !t.reviewed && (
                  <RatingForm projectId={project.id} teammate={t} onRated={() => onRated(t.id)} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const AXES: { key: 'collaboration' | 'quality' | 'reliability' | 'communication'; labelKey: string }[] = [
  { key: 'collaboration', labelKey: 'proj.axCollaboration' },
  { key: 'quality', labelKey: 'proj.axQuality' },
  { key: 'reliability', labelKey: 'proj.axReliability' },
  { key: 'communication', labelKey: 'proj.axCommunication' },
]

function RatingForm({ projectId, teammate, onRated }: {
  projectId: string
  teammate: Teammate
  onRated: () => void
}) {
  const tr = useT()
  const [scores, setScores] = useState<Record<string, number>>({ collaboration: 0, quality: 0, reliability: 0, communication: 0 })
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (Object.values(scores).some(v => v < 1)) {
      toast.error(tr('proj.rateAll4'))
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewee_id: teammate.id, ...scores, comment: comment.trim() || null }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? tr('proj.error'))
      toast.success(tr('proj.ratingSent'))
      onRated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('common.unknownError'))
      setLoading(false)
    }
  }

  return (
    <div className="px-3 py-3 border-t border-border bg-muted/30 space-y-3">
      {AXES.map(ax => (
        <div key={ax.key} className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{tr(ax.labelKey)}</span>
          <StarRow value={scores[ax.key]} onChange={v => setScores(s => ({ ...s, [ax.key]: v }))} disabled={loading} />
        </div>
      ))}
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        maxLength={1000}
        rows={2}
        disabled={loading}
        placeholder={tr('proj.commentPlaceholder')}
        className={`${INPUT} resize-none text-xs`}
      />
      <button
        onClick={submit}
        disabled={loading}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />} {tr('proj.sendRating')}
      </button>
    </div>
  )
}

function StarRow({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onClick={() => onChange(n)} disabled={disabled} className="disabled:cursor-default">
          <Star className={`w-4 h-4 transition-colors ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40 hover:text-amber-400'}`} />
        </button>
      ))}
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
