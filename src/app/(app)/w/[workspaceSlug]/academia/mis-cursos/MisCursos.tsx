'use client'

/**
 * Lista de los cursos que escribio esta persona, con su estado y lo unico que
 * puede hacer con cada uno.
 *
 * El estado se dice con PALABRAS, no con un color. "En revisión" y "Devuelto"
 * significan cosas distintas para quien escribio el curso: uno es esperar, el
 * otro es trabajo. Un punto de color obliga a recordar la leyenda.
 *
 * Cuando un curso vuelve devuelto se muestra el MOTIVO en la propia tarjeta.
 * Esconderlo detras de un clic es la forma de que nadie lo lea y vuelva a
 * mandar lo mismo.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AcademyIcon } from '@/lib/academy/icons'
import { Plus, Loader2, Trash2, ArrowRight, MessageSquareWarning } from 'lucide-react'
import type { EstadoCursoEquipo } from '@/lib/academy/catalog'

export interface CursoPropio {
  id: string
  courseId: string
  status: EstadoCursoEquipo
  title: string
  subtitle: string
  icon: string
  accent: string
  track: string
  modulos: number
  reviewNote: string | null
  updatedAt: string
}

const ETIQUETA: Record<EstadoCursoEquipo, { texto: string; clase: string }> = {
  draft: { texto: 'Borrador', clase: 'bg-muted text-muted-foreground' },
  pending_review: { texto: 'En revisión', clase: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  published: { texto: 'Publicado', clase: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  rejected: { texto: 'Devuelto', clase: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  archived: { texto: 'Archivado', clase: 'bg-muted text-muted-foreground' },
}

export function MisCursos({
  workspaceSlug,
  workspaceId,
  cursos,
}: {
  workspaceSlug: string
  workspaceId: string
  cursos: CursoPropio[]
}) {
  const router = useRouter()
  const [creando, setCreando] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function crear() {
    const t = titulo.trim()
    if (t.length < 3) {
      toast.error('El título necesita al menos 3 caracteres.')
      return
    }
    setOcupado(true)
    try {
      const res = await fetch('/api/academy/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'No se pudo crear el curso')
      toast.success('Borrador creado')
      router.push(`/w/${workspaceSlug}/academia/mis-cursos/${json.course.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error inesperado')
      setOcupado(false)
    }
  }

  async function borrar(curso: CursoPropio) {
    if (!confirm(`¿Borrar el borrador "${curso.title}"? No se puede deshacer.`)) return
    setOcupado(true)
    try {
      const res = await fetch(`/api/academy/courses/${curso.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'No se pudo borrar')
      toast.success('Borrador borrado')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setOcupado(false)
    }
  }

  async function retirar(curso: CursoPropio) {
    setOcupado(true)
    try {
      const res = await fetch(`/api/academy/courses/${curso.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retirar', workspaceId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'No se pudo retirar')
      toast.success('Se retiró de revisión. Vuelve a ser un borrador.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Mis cursos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lo que has escrito tú. Para que entre a la biblioteca lo tiene que aprobar un admin.
          </p>
        </div>
        <Link
          href={`/w/${workspaceSlug}/academia`}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Ir a la biblioteca
        </Link>
      </div>

      {creando ? (
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <label className="mb-2 block text-sm font-medium text-foreground" htmlFor="titulo-curso">
            ¿Cómo se llama el curso?
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="titulo-curso"
              autoFocus
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !ocupado && crear()}
              placeholder="Cómo cotizar un estacionamiento"
              maxLength={120}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={crear}
              disabled={ocupado}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {ocupado && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear borrador
            </button>
            <button
              type="button"
              onClick={() => setCreando(false)}
              disabled={ocupado}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            El título se puede cambiar después. La dirección del curso se genera de él y ya no cambia.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreando(true)}
          className="mb-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Escribir un curso
        </button>
      )}

      {cursos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm font-medium text-foreground">Todavía no has escrito ningún curso.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Si sabes hacer algo que aquí se hace, escríbelo. No hace falta permiso para empezar:
            el permiso hace falta para publicarlo.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {cursos.map((c) => {
            const et = ETIQUETA[c.status]
            return (
              <li key={c.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${c.accent}22`, color: c.accent }}
                  >
                    <AcademyIcon name={c.icon} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold text-foreground">{c.title}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${et.clase}`}>
                        {et.texto}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                      {c.subtitle || 'Sin descripción'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.modulos === 1 ? '1 módulo' : `${c.modulos} módulos`} · {c.courseId}
                    </p>

                    {c.status === 'rejected' && c.reviewNote && (
                      <div className="mt-3 flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
                        <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground">Por qué se devolvió</p>
                          <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                            {c.reviewNote}
                          </p>
                        </div>
                      </div>
                    )}
                    {c.status === 'draft' && c.reviewNote && (
                      <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
                        <p className="text-xs font-medium text-foreground">Un admin lo reabrió</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                          {c.reviewNote}
                        </p>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {(c.status === 'draft' || c.status === 'rejected') && (
                        <Link
                          href={`/w/${workspaceSlug}/academia/mis-cursos/${c.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                        >
                          Seguir escribiendo <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      {c.status === 'pending_review' && (
                        <button
                          type="button"
                          onClick={() => retirar(c)}
                          disabled={ocupado}
                          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                        >
                          Retirar de revisión
                        </button>
                      )}
                      {c.status === 'published' && (
                        <>
                          <Link
                            href={`/w/${workspaceSlug}/academia/${c.courseId}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
                          >
                            Verlo en la biblioteca <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            Para cambiarlo, pide a un admin que lo reabra.
                          </span>
                        </>
                      )}
                      {c.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => borrar(c)}
                          disabled={ocupado}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-rose-500 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Borrar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
