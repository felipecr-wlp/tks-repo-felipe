'use client'

/**
 * Cola de revisión de cursos escritos por el equipo.
 *
 * TRES DECISIONES QUE SOSTIENEN ESTA PANTALLA:
 *
 * 1. EL CURSO SE LEE AQUI, COMPLETO. Aprobar sin poder leer convierte la
 *    revisión en un trámite: el botón verde se aprieta igual esté bien o mal el
 *    contenido, y entonces el permiso no protege de nada. Por eso cada curso se
 *    despliega con sus módulos, sus lecciones y su examen dentro de la misma
 *    pantalla, sin ir a otro lado y sin volver.
 *
 * 2. RECHAZAR EXIGE ESCRIBIR EL MOTIVO, y la caja aparece ANTES de que el botón
 *    sirva. El API ya lo exige (422 sin nota), pero descubrirlo por un error
 *    después de haber decidido es tratar al revisor como a un intruso. La regla
 *    se muestra, no se castiga.
 *
 * 3. EL PROPIO CURSO NO SE PUEDE APROBAR. La interfaz lo dice con palabras en
 *    vez de esconder los botones: quien escribió el curso y además es admin
 *    tiene que entender POR QUE no puede, o creerá que hay una falla.
 */
import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  Undo2,
  Archive,
  ClipboardCheck,
  CircleHelp,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { AcademyIcon } from '@/lib/academy/icons'
import type { Module } from '@/lib/academy/types'
import type { EstadoCursoEquipo } from '@/lib/academy/catalog'

export interface CursoEnRevision {
  id: string
  courseId: string
  authorId: string | null
  status: EstadoCursoEquipo
  title: string
  subtitle: string
  track: string
  icon: string
  accent: string
  reviewNote: string | null
  submittedAt: string | null
  updatedAt: string
  autor: { nombre: string; avatar: string | null } | null
  modules: Module[]
}

/** Acciones que un mando puede tomar sobre un curso ajeno. */
type AccionAdmin = 'aprobar' | 'rechazar' | 'reabrir' | 'archivar'

function fecha(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Cuenta lo que el revisor querría saber de un vistazo antes de abrir nada. */
function resumen(modules: Module[]) {
  let lecciones = 0
  let preguntas = 0
  for (const m of modules) {
    lecciones += Array.isArray(m.lessons) ? m.lessons.length : 0
    preguntas += Array.isArray(m.quiz) ? m.quiz.length : 0
  }
  return { modulos: modules.length, lecciones, preguntas }
}

export function RevisionCursos({
  workspaceId,
  yoId,
  cursos,
}: {
  workspaceId: string
  yoId: string
  cursos: CursoEnRevision[]
}) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [rechazando, setRechazando] = useState<string | null>(null)

  const pendientes = cursos.filter((c) => c.status === 'pending_review')
  const publicados = cursos.filter((c) => c.status === 'published')
  const devueltos = cursos.filter((c) => c.status === 'rejected')

  async function decidir(curso: CursoEnRevision, accion: AccionAdmin) {
    const nota = (notas[curso.id] ?? '').trim()
    setOcupado(curso.id)
    try {
      const res = await fetch(`/api/academy/courses/${curso.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: accion, workspaceId, nota: nota || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Si el curso no pasó la validación, los problemas concretos importan
        // mucho más que "no se pudo aprobar".
        if (Array.isArray(json.problemas) && json.problemas.length > 0) {
          toast.error(
            `El curso no está listo: ${json.problemas[0].donde} · ${json.problemas[0].que}`,
            { duration: 9000 },
          )
          return
        }
        throw new Error(json.error || 'No se pudo completar la acción')
      }
      const dicho: Record<AccionAdmin, string> = {
        aprobar: 'Curso publicado. Ya se puede conceder acceso como a cualquier otro.',
        rechazar: 'Devuelto al autor con tus comentarios.',
        reabrir: 'Reabierto. El autor puede volver a editarlo; el avance de quien lo estudió no se toca.',
        archivar: 'Archivado. Deja de aparecer en la biblioteca.',
      }
      toast.success(dicho[accion])
      setRechazando(null)
      setNotas((n) => ({ ...n, [curso.id]: '' }))
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setOcupado(null)
    }
  }

  function Tarjeta({ curso }: { curso: CursoEnRevision }) {
    const esMio = curso.authorId === yoId
    const r = resumen(curso.modules)
    const expandido = abierto === curso.id
    const trabajando = ocupado === curso.id

    return (
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-start gap-3 p-4">
          <span
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${curso.accent}22`, color: curso.accent }}
          >
            <AcademyIcon name={curso.icon} className="h-5 w-5" />
          </span>

          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold text-foreground">{curso.title}</h3>
            <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
              {curso.subtitle || 'Sin descripción'}
            </p>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                {curso.autor?.avatar ? (
                  <Image
                    src={curso.autor.avatar}
                    alt=""
                    width={18}
                    height={18}
                    className="h-[18px] w-[18px] rounded-full object-cover"
                  />
                ) : null}
                Escrito por{' '}
                <span className="font-medium text-foreground">
                  {curso.autor?.nombre ?? 'Alguien que ya no está'}
                </span>
              </span>
              <span>
                {r.modulos} módulo{r.modulos === 1 ? '' : 's'} · {r.lecciones} lección
                {r.lecciones === 1 ? '' : 'es'} · {r.preguntas} pregunta
                {r.preguntas === 1 ? '' : 's'}
              </span>
              {curso.status === 'pending_review' && curso.submittedAt && (
                <span>Enviado el {fecha(curso.submittedAt)}</span>
              )}
              <span className="font-mono">{curso.courseId}</span>
            </div>

            <button
              type="button"
              onClick={() => setAbierto(expandido ? null : curso.id)}
              className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {expandido ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {expandido ? 'Ocultar el contenido' : 'Leer el curso completo'}
            </button>
          </div>
        </div>

        {expandido && <Contenido modules={curso.modules} />}

        {/* Acciones */}
        <div className="border-t border-border p-3">
          {curso.status === 'pending_review' &&
            (esMio ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <CircleHelp className="mt-px h-4 w-4 shrink-0" />
                Este curso lo escribiste tú. La revisión existe para que haya un segundo par de
                ojos, así que tiene que aprobarlo otro admin.
              </p>
            ) : (
              <>
                {rechazando === curso.id && (
                  <div className="mb-3">
                    <label
                      className="mb-1.5 block text-xs font-medium text-foreground"
                      htmlFor={`nota-${curso.id}`}
                    >
                      ¿Qué hay que corregir? Esto es lo único que va a ver el autor.
                    </label>
                    <textarea
                      id={`nota-${curso.id}`}
                      autoFocus
                      rows={3}
                      value={notas[curso.id] ?? ''}
                      onChange={(e) => setNotas((n) => ({ ...n, [curso.id]: e.target.value }))}
                      placeholder="El módulo 2 explica el proceso viejo. Actualízalo con el flujo que usamos desde junio."
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                    />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => decidir(curso, 'aprobar')}
                    disabled={trabajando}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {trabajando ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Aprobar y publicar
                  </button>

                  {rechazando === curso.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => decidir(curso, 'rechazar')}
                        disabled={trabajando || !(notas[curso.id] ?? '').trim()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-40"
                      >
                        <X className="h-3.5 w-3.5" /> Devolver con estos comentarios
                      </button>
                      <button
                        type="button"
                        onClick={() => setRechazando(null)}
                        disabled={trabajando}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRechazando(curso.id)}
                      disabled={trabajando}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" /> Devolver al autor
                    </button>
                  )}
                </div>
              </>
            ))}

          {curso.status === 'published' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => decidir(curso, 'reabrir')}
                disabled={trabajando}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                <Undo2 className="h-3.5 w-3.5" /> Reabrir para editar
              </button>
              <button
                type="button"
                onClick={() => decidir(curso, 'archivar')}
                disabled={trabajando}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-rose-500 disabled:opacity-50"
              >
                <Archive className="h-3.5 w-3.5" /> Archivar
              </button>
              <span className="text-xs text-muted-foreground">
                Reabrir no borra nada: el avance y los accesos siguen ahí cuando vuelva a publicarse.
              </span>
            </div>
          )}

          {curso.status === 'rejected' && (
            <p className="text-xs text-muted-foreground">
              Devuelto al autor. Le toca a esa persona corregirlo y volver a enviarlo.
              {curso.reviewNote ? ` Motivo: "${curso.reviewNote}"` : ''}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 py-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Cursos del equipo</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Cualquiera puede escribir un curso. Para que entre a la biblioteca lo tiene que leer y
          aprobar un admin que no sea quien lo escribió.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Esperando revisión {pendientes.length > 0 && `(${pendientes.length})`}
        </h2>
        {pendientes.length === 0 ? (
          <EmptyState
            compact
            icon={<ClipboardCheck className="h-5 w-5" />}
            title="Nada pendiente por revisar"
            description="Cuando alguien envíe un curso, aparecerá aquí con su contenido para leerlo antes de decidir."
          />
        ) : (
          <div className="space-y-3">
            {pendientes.map((c) => (
              <Tarjeta key={c.id} curso={c} />
            ))}
          </div>
        )}
      </section>

      {publicados.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Publicados ({publicados.length})
          </h2>
          <div className="space-y-3">
            {publicados.map((c) => (
              <Tarjeta key={c.id} curso={c} />
            ))}
          </div>
        </section>
      )}

      {devueltos.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Devueltos ({devueltos.length})
          </h2>
          <div className="space-y-3">
            {devueltos.map((c) => (
              <Tarjeta key={c.id} curso={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/**
 * El curso entero, en texto plano y legible.
 *
 * No reproduce el lector real (colores, tarjetas, progreso) porque aquí no se
 * viene a estudiar: se viene a juzgar si el contenido sirve. Lo que importa es
 * ver TODO de corrido, incluida la respuesta correcta de cada pregunta, que es
 * justo lo que el lector normal esconde.
 */
function Contenido({ modules }: { modules: Module[] }) {
  return (
    <div className="border-t border-border bg-muted/30 p-4">
      {modules.length === 0 ? (
        <p className="text-sm text-muted-foreground">El curso no tiene módulos.</p>
      ) : (
        <ol className="space-y-5">
          {modules.map((m, mi) => (
            <li key={m.id || mi}>
              <p className="text-sm font-semibold text-foreground">
                {mi + 1}. {m.title || <span className="text-rose-500">(sin título)</span>}
              </p>

              {(m.lessons ?? []).map((l, li) => (
                <div key={li} className="mt-2 border-l-2 border-border pl-3">
                  <p className="text-sm font-medium text-foreground">
                    {l.t || <span className="text-rose-500">(lección sin título)</span>}
                  </p>
                  {(l.blocks ?? []).map((b, bi) => (
                    <p key={bi} className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                      {b.type === 'rule'
                        ? '———'
                        : b.type === 'table'
                          ? `[tabla de ${Array.isArray(b.rows) ? b.rows.length : 0} filas]`
                          : Array.isArray(b.v)
                            ? b.v.map((x) => `• ${String(x)}`).join('\n')
                            : String(b.v ?? '')}
                    </p>
                  ))}
                </div>
              ))}

              <div className="mt-3 rounded-lg border border-border bg-background p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Examen ({(m.quiz ?? []).length} pregunta{(m.quiz ?? []).length === 1 ? '' : 's'})
                </p>
                {(m.quiz ?? []).length === 0 ? (
                  <p className="mt-1 text-xs text-rose-500">
                    Sin examen. El avance solo se guarda al aprobar un quiz, así que este módulo
                    nunca se podría completar.
                  </p>
                ) : (
                  <ol className="mt-2 space-y-2">
                    {(m.quiz ?? []).map((q, qi) => (
                      <li key={qi} className="text-xs">
                        <p className="font-medium text-foreground">
                          {qi + 1}. {q.q}
                        </p>
                        <ul className="mt-0.5 space-y-0.5">
                          {(q.opts ?? []).map((o, oi) => (
                            <li
                              key={oi}
                              className={
                                oi === q.a
                                  ? 'font-medium text-emerald-600 dark:text-emerald-400'
                                  : 'text-muted-foreground'
                              }
                            >
                              {oi === q.a ? '✓ ' : '• '}
                              {o}
                            </li>
                          ))}
                        </ul>
                        {q.ex && (
                          <p className="mt-0.5 italic text-muted-foreground">Explicación: {q.ex}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
