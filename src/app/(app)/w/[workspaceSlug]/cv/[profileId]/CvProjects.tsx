'use client'

/**
 * CvProjects: historial de proyectos del CV + modal de calificacion anonima.
 *
 * En el CV propio (isOwn), cada proyecto ofrece "Calificar compañeros": abre un
 * modal que trae los companeros del proyecto (GET /api/projects/[id]/reviews),
 * marca a quienes ya calificaste, y permite enviar una evaluacion 1..5 en cuatro
 * ejes (colaboracion, calidad, confiabilidad, comunicacion) + comentario.
 *
 * Anonimato: el evaluado nunca ve quien lo califico; solo promedios agregados.
 */
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Crown, Archive, MessageSquarePlus, Loader2, Check, Star, FolderKanban } from 'lucide-react'
import { useT, useI18n } from '@/lib/i18n/LanguageProvider'

export type CvProject = {
  id: string
  name: string
  icon: string | null
  status: string | null
  is_archived: boolean
  role: string
  title: string | null
  contribution: string | null
  joined_at: string
  is_lead: boolean
}

type Teammate = {
  id: string
  display_name: string | null
  avatar_url: string | null
  reviewed: boolean
}

export function CvProjects({ projects, isOwn }: {
  projects: CvProject[]
  isOwn: boolean
}) {
  const { t, lang } = useI18n()
  const [reviewProject, setReviewProject] = useState<CvProject | null>(null)

  if (projects.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">{t('cv.history')}</h2>
        <p className="text-sm text-muted-foreground bg-card border border-border rounded-xl p-5">
          {isOwn ? t('cv.emptyOwn') : t('cv.emptyOther')}
        </p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-3">{t('cv.history')}</h2>
      <div className="space-y-3">
        {projects.map(p => (
          <div key={p.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <FolderKanban className="w-5 h-5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground">{p.name}</p>
                  {p.is_lead && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600">
                      <Crown className="w-3 h-3" /> {t('cv.lead')}
                    </span>
                  )}
                  {p.is_archived && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      <Archive className="w-3 h-3" /> {t('cv.archived')}
                    </span>
                  )}
                </div>
                {p.title && <p className="text-xs text-muted-foreground mt-0.5">{p.title}</p>}
                {p.contribution && <p className="text-sm text-foreground/80 mt-2 whitespace-pre-wrap">{p.contribution}</p>}
                <p className="text-[11px] text-muted-foreground mt-2">
                  {t('form.roleLabel')} <span className="capitalize">{p.role}</span> · {t('cv.sincePrefix')} {new Date(p.joined_at).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', { year: 'numeric', month: 'short' })}
                </p>
              </div>
            </div>

            {isOwn && (
              <div className="flex justify-end mt-3">
                <button
                  onClick={() => setReviewProject(p)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" /> {t('cv.rateTeammates')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {reviewProject && (
        <ReviewModal
          project={reviewProject}
          onClose={() => setReviewProject(null)}
        />
      )}
    </section>
  )
}

function ReviewModal({ project, onClose }: {
  project: CvProject
  onClose: () => void
}) {
  const tr = useT()
  const [teammates, setTeammates] = useState<Teammate[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Teammate | null>(null)

  // Cargar compañeros al abrir
  useEffect(() => {
    let alive = true
    fetch(`/api/projects/${project.id}/reviews`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? tr('cv.loadError'))
        if (alive) setTeammates(data.teammates as Teammate[])
      })
      .catch(err => { if (alive) setLoadError(err instanceof Error ? err.message : tr('common.unknownError')) })
    return () => { alive = false }
  }, [project.id, tr])

  const markReviewed = (id: string) => {
    setTeammates(prev => prev?.map(t => t.id === id ? { ...t, reviewed: true } : t) ?? null)
    setSelected(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-overlay w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <FolderKanban className="w-4 h-4 text-primary" />
          </span>
          {tr('cv.rateTeammates')}
        </h2>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          {project.name}. {tr('cv.anonNote')}
        </p>

        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : teammates === null ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : selected ? (
          <ReviewForm
            project={project}
            teammate={selected}
            onBack={() => setSelected(null)}
            onDone={() => markReviewed(selected.id)}
          />
        ) : teammates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr('cv.noTeammates')}</p>
        ) : (
          <div className="space-y-2">
            {teammates.map(t => (
              <button
                key={t.id}
                onClick={() => !t.reviewed && setSelected(t)}
                disabled={t.reviewed}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border text-left hover:bg-muted transition-colors disabled:opacity-60 disabled:cursor-default"
              >
                <TeammateAvatar url={t.avatar_url} name={t.display_name} />
                <span className="text-sm text-foreground flex-1 truncate">{t.display_name ?? tr('cv.teammate')}</span>
                {t.reviewed && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                    <Check className="w-3.5 h-3.5" /> {tr('cv.rated')}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {!selected && (
          <div className="flex justify-end pt-4">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors">
              {tr('common.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const AXES = [
  { key: 'collaboration', labelKey: 'cv.axisCollaboration' },
  { key: 'quality',       labelKey: 'cv.axisQuality' },
  { key: 'reliability',   labelKey: 'cv.axisReliability' },
  { key: 'communication', labelKey: 'cv.axisCommunication' },
] as const

type AxisKey = typeof AXES[number]['key']

function ReviewForm({ project, teammate, onBack, onDone }: {
  project: CvProject
  teammate: Teammate
  onBack: () => void
  onDone: () => void
}) {
  const t = useT()
  const [scores, setScores] = useState<Record<AxisKey, number>>({
    collaboration: 0, quality: 0, reliability: 0, communication: 0,
  })
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)

  const complete = AXES.every(a => scores[a.key] >= 1)

  const submit = async () => {
    if (!complete) {
      toast.error(t('cv.rateAllAxes'))
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewee_id: teammate.id,
          collaboration: scores.collaboration,
          quality: scores.quality,
          reliability: scores.reliability,
          communication: scores.communication,
          comment: comment.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('cv.reviewError'))
      toast.success(t('cv.reviewSent'))
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <TeammateAvatar url={teammate.avatar_url} name={teammate.display_name} />
        <p className="text-sm font-medium text-foreground">{teammate.display_name ?? t('cv.teammate')}</p>
      </div>

      <div className="space-y-3">
        {AXES.map(a => (
          <div key={a.key} className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">{t(a.labelKey)}</span>
            <StarRow value={scores[a.key]} onChange={v => setScores(s => ({ ...s, [a.key]: v }))} disabled={loading} ofFive={t('cv.ofFive')} />
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">{t('cv.comment')} <span className="text-muted-foreground text-xs">{t('form.optional')}</span></label>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          maxLength={1000}
          rows={3}
          disabled={loading}
          placeholder={t('cv.commentPlaceholder')}
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button onClick={onBack} disabled={loading} className="flex-1 px-4 py-2.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
          {t('cv.back')}
        </button>
        <button onClick={submit} disabled={loading || !complete} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('cv.sending')}</> : t('cv.send')}
        </button>
      </div>
    </div>
  )
}

function StarRow({ value, onChange, disabled, ofFive }: { value: number; onChange: (v: number) => void; disabled: boolean; ofFive: string }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          disabled={disabled}
          className="p-0.5 disabled:opacity-50"
          aria-label={`${n} ${ofFive}`}
        >
          <Star className={`w-4 h-4 ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} />
        </button>
      ))}
    </div>
  )
}

function TeammateAvatar({ url, name }: { url: string | null; name: string | null }) {
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
