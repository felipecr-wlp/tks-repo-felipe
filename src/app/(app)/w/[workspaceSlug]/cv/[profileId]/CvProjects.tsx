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
  const [reviewProject, setReviewProject] = useState<CvProject | null>(null)

  if (projects.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Historial de proyectos</h2>
        <p className="text-sm text-muted-foreground bg-card border border-border rounded-xl p-5">
          {isOwn
            ? 'Aún no participas en ningún proyecto. Postúlate a uno abierto para empezar tu CV.'
            : 'Este perfil aún no participa en proyectos.'}
        </p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-3">Historial de proyectos</h2>
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
                      <Crown className="w-3 h-3" /> Líder
                    </span>
                  )}
                  {p.is_archived && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      <Archive className="w-3 h-3" /> Archivado
                    </span>
                  )}
                </div>
                {p.title && <p className="text-xs text-muted-foreground mt-0.5">{p.title}</p>}
                {p.contribution && <p className="text-sm text-foreground/80 mt-2 whitespace-pre-wrap">{p.contribution}</p>}
                <p className="text-[11px] text-muted-foreground mt-2">
                  Rol: <span className="capitalize">{p.role}</span> · desde {new Date(p.joined_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'short' })}
                </p>
              </div>
            </div>

            {isOwn && (
              <div className="flex justify-end mt-3">
                <button
                  onClick={() => setReviewProject(p)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" /> Calificar compañeros
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
  const [teammates, setTeammates] = useState<Teammate[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Teammate | null>(null)

  // Cargar compañeros al abrir
  useEffect(() => {
    let alive = true
    fetch(`/api/projects/${project.id}/reviews`)
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Error al cargar')
        if (alive) setTeammates(data.teammates as Teammate[])
      })
      .catch(err => { if (alive) setLoadError(err instanceof Error ? err.message : 'Error desconocido') })
    return () => { alive = false }
  }, [project.id])

  const markReviewed = (id: string) => {
    setTeammates(prev => prev?.map(t => t.id === id ? { ...t, reviewed: true } : t) ?? null)
    setSelected(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <FolderKanban className="w-4 h-4 text-primary" />
          </span>
          Calificar compañeros
        </h2>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          {project.name}. Tu calificación es anónima: el compañero solo verá promedios agregados.
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
          <p className="text-sm text-muted-foreground">No hay otros compañeros en este proyecto todavía.</p>
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
                <span className="text-sm text-foreground flex-1 truncate">{t.display_name ?? 'Compañero'}</span>
                {t.reviewed && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                    <Check className="w-3.5 h-3.5" /> Calificado
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {!selected && (
          <div className="flex justify-end pt-4">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors">
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const AXES = [
  { key: 'collaboration', label: 'Colaboración' },
  { key: 'quality',       label: 'Calidad' },
  { key: 'reliability',   label: 'Confiabilidad' },
  { key: 'communication', label: 'Comunicación' },
] as const

type AxisKey = typeof AXES[number]['key']

function ReviewForm({ project, teammate, onBack, onDone }: {
  project: CvProject
  teammate: Teammate
  onBack: () => void
  onDone: () => void
}) {
  const [scores, setScores] = useState<Record<AxisKey, number>>({
    collaboration: 0, quality: 0, reliability: 0, communication: 0,
  })
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)

  const complete = AXES.every(a => scores[a.key] >= 1)

  const submit = async () => {
    if (!complete) {
      toast.error('Califica los cuatro ejes')
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
      if (!res.ok) throw new Error(data.error ?? 'Error al calificar')
      toast.success('Calificacion enviada')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <TeammateAvatar url={teammate.avatar_url} name={teammate.display_name} />
        <p className="text-sm font-medium text-foreground">{teammate.display_name ?? 'Compañero'}</p>
      </div>

      <div className="space-y-3">
        {AXES.map(a => (
          <div key={a.key} className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">{a.label}</span>
            <StarRow value={scores[a.key]} onChange={v => setScores(s => ({ ...s, [a.key]: v }))} disabled={loading} />
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Comentario <span className="text-muted-foreground text-xs">(opcional)</span></label>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          maxLength={1000}
          rows={3}
          disabled={loading}
          placeholder="¿Qué destacarías de trabajar con esta persona?"
          className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button onClick={onBack} disabled={loading} className="flex-1 px-4 py-2.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
          Atrás
        </button>
        <button onClick={submit} disabled={loading || !complete} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Enviando...</> : 'Enviar'}
        </button>
      </div>
    </div>
  )
}

function StarRow({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          disabled={disabled}
          className="p-0.5 disabled:opacity-50"
          aria-label={`${n} de 5`}
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
