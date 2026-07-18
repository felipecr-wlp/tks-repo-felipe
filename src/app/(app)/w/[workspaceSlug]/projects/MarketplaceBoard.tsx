'use client'

/**
 * MarketplaceBoard: grilla de proyectos abiertos + modal de postulacion.
 *
 * Muestra el estado del solicitante por proyecto: puede postularse, ya se
 * postulo (pending/accepted/rejected), o ya es miembro. El lider ve un acceso a
 * "Gestionar" para revisar postulaciones y editar el charter.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Users, Clock, Crown, ClipboardList, Loader2, FolderKanban } from 'lucide-react'

export type MarketProject = {
  id: string
  name: string
  icon: string | null
  description: string | null
  scope: string | null
  deliverables: string | null
  application_deadline: string | null
  max_members: number | null
  member_count: number
  lead: { id: string; display_name: string | null; avatar_url: string | null } | null
  is_lead: boolean
  is_member: boolean
  my_application_status: string | null
}

function deadlineLabel(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000)
  if (days < 0) return 'Cerrado'
  if (days === 0) return 'Cierra hoy'
  if (days === 1) return 'Cierra mañana'
  return `Cierra en ${days} dias`
}

export function MarketplaceBoard({ projects, workspaceSlug }: { projects: MarketProject[]; workspaceSlug: string }) {
  const [applyFor, setApplyFor] = useState<MarketProject | null>(null)

  if (projects.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-border rounded-xl">
        <ClipboardList className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
        <h3 className="text-sm font-medium text-foreground mb-1">No hay proyectos abiertos</h3>
        <p className="text-sm text-muted-foreground">
          Cuando un lider abra un proyecto a postulaciones, aparecera aqui.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {projects.map(p => (
          <div key={p.id} className="bg-card border border-border rounded-xl p-5 flex flex-col hover:border-ring/40 transition-colors">
            <div className="flex items-start gap-3 mb-2">
              <span className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <FolderKanban className="w-5 h-5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground truncate">{p.name}</h3>
                {p.lead && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Crown className="w-3 h-3" /> {p.lead.display_name ?? 'Lider'}
                  </p>
                )}
              </div>
            </div>

            {p.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{p.description}</p>
            )}

            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-4 mt-auto">
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {p.member_count}{p.max_members ? `/${p.max_members}` : ''}
              </span>
              {deadlineLabel(p.application_deadline) && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {deadlineLabel(p.application_deadline)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {p.is_member ? (
                <span className="flex-1 text-center px-3 py-2 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-600">
                  Ya eres miembro
                </span>
              ) : p.my_application_status === 'pending' ? (
                <span className="flex-1 text-center px-3 py-2 text-xs font-medium rounded-lg bg-amber-500/10 text-amber-600">
                  Postulacion enviada
                </span>
              ) : p.my_application_status === 'rejected' ? (
                <span className="flex-1 text-center px-3 py-2 text-xs font-medium rounded-lg bg-muted text-muted-foreground">
                  No seleccionado
                </span>
              ) : (
                <button
                  onClick={() => setApplyFor(p)}
                  className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Postularme
                </button>
              )}

              {p.is_lead && (
                <Link
                  href={`/w/${workspaceSlug}/projects/${p.id}`}
                  className="px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  Gestionar
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>

      {applyFor && (
        <ApplyModal
          project={applyFor}
          onClose={() => setApplyFor(null)}
        />
      )}
    </>
  )
}

function ApplyModal({ project, onClose }: { project: MarketProject; onClose: () => void }) {
  const router = useRouter()
  const [pitch, setPitch] = useState('')
  const [roleDesired, setRoleDesired] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (pitch.trim().length < 10) {
      toast.error('Cuentanos un poco mas (minimo 10 caracteres)')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitch: pitch.trim(), role_desired: roleDesired.trim() || null }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Error al postular')
      toast.success('Postulacion enviada')
      onClose()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-overlay w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <FolderKanban className="w-4 h-4 text-primary" />
          </span>
          Postularme a {project.name}
        </h2>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          El lider vera tu mensaje y decidira. Se claro sobre lo que aportas.
        </p>

        {(project.scope || project.deliverables) && (
          <div className="mb-4 space-y-2 text-xs bg-muted/50 rounded-lg p-3">
            {project.scope && <p><span className="font-medium text-foreground">Alcance:</span> <span className="text-muted-foreground">{project.scope}</span></p>}
            {project.deliverables && <p><span className="font-medium text-foreground">Entregables:</span> <span className="text-muted-foreground">{project.deliverables}</span></p>}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Rol que buscas <span className="text-muted-foreground text-xs">(opcional)</span></label>
            <input
              value={roleDesired}
              onChange={e => setRoleDesired(e.target.value)}
              maxLength={120}
              placeholder="Ej: Diseñador, Analista de datos"
              disabled={loading}
              className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Tu mensaje <span className="text-destructive">*</span></label>
            <textarea
              value={pitch}
              onChange={e => setPitch(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="¿Por que quieres entrar y que aportas al proyecto?"
              disabled={loading}
              className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
            />
            <p className="text-[11px] text-muted-foreground text-right">{pitch.length}/2000</p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4">
          <button onClick={onClose} disabled={loading} className="flex-1 px-4 py-2.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={submit} disabled={loading} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Enviando...</> : 'Enviar postulacion'}
          </button>
        </div>
      </div>
    </div>
  )
}
