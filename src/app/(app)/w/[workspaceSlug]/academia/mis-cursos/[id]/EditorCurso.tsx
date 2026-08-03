'use client'

/**
 * Editor de un curso del equipo.
 *
 * DOS DECISIONES QUE VALE LA PENA EXPLICAR.
 *
 * 1. El id de un modulo se genera UNA VEZ y despues no se mueve. `academy_progress`
 *    recuerda el avance por (curso, modulo); si el id cambiara al renombrar el
 *    modulo, el avance de todo el que iba a la mitad se quedaria colgando de un
 *    id que ya no existe. No fallaria nada: la barra simplemente volveria atras.
 *    Por eso solo se fija mientras siga siendo el marcador de recien creado.
 *
 * 2. Los problemas se muestran TODOS juntos y con el lugar exacto. Corregir de
 *    uno en uno, enviando y volviendo a fallar, es la forma mas rapida de que
 *    alguien abandone el curso que estaba escribiendo.
 *
 * Se guarda a mano, no solo. Guardar solo esta bien cuando el borrador es tuyo y
 * de nadie mas; aqui el boton dice cuando hay trabajo sin guardar, que es la
 * informacion que de verdad importa antes de cerrar la pestaña.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Save,
  Send,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { idDesdeTituloModulo, type ProblemaCurso } from '@/lib/academy/validar-curso'
import type { Block, Lesson, Module, QuizQuestion, CourseLang } from '@/lib/academy/types'

interface Datos {
  title: string
  subtitle: string
  track: string
  icon: string
  accent: string
  lang: CourseLang
  certName: string
  modules: Module[]
}

/** Marcador de modulo recien creado: mientras el id sea esto, se puede fijar. */
const ID_PROVISIONAL = /^modulo(-\d+)?$/

const TIPOS_BLOQUE: Array<{ v: Block['type']; label: string; ayuda: string }> = [
  { v: 'p', label: 'Párrafo', ayuda: 'Texto normal.' },
  { v: 'h', label: 'Subtítulo', ayuda: 'Separa una idea de la siguiente.' },
  { v: 'list', label: 'Viñetas', ayuda: 'Una por línea.' },
  { v: 'ol', label: 'Lista numerada', ayuda: 'Una por línea. Para pasos en orden.' },
  { v: 'callout', label: 'Nota destacada', ayuda: 'Lo que no se puede pasar por alto.' },
  { v: 'rule', label: 'Separador', ayuda: 'Una línea. No lleva texto.' },
]

const ICONOS = [
  'cap', 'compass', 'target', 'ruler', 'wrench', 'shield', 'users', 'building',
  'receipt', 'landmark', 'database', 'layers', 'lock', 'mic', 'repeat', 'alert',
  'file', 'lightbulb', 'send', 'trophy',
]

const COLORES = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6']

const claseInput =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary'

export function EditorCurso({
  workspaceSlug,
  workspaceId,
  cursoId,
  courseId,
  estado,
  reviewNote,
  inicial,
}: {
  workspaceSlug: string
  workspaceId: string
  cursoId: string
  courseId: string
  estado: 'draft' | 'rejected'
  reviewNote: string | null
  inicial: Datos
}) {
  const router = useRouter()
  const [d, setD] = useState<Datos>(inicial)
  const [sucio, setSucio] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [problemas, setProblemas] = useState<ProblemaCurso[]>([])
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set(inicial.modules.slice(0, 1).map((m) => m.id)))

  const volver = `/w/${workspaceSlug}/academia/mis-cursos`

  // Cerrar la pestaña con trabajo sin guardar tiene que costar un clic.
  useEffect(() => {
    if (!sucio) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [sucio])

  const cambiar = useCallback((patch: Partial<Datos>) => {
    setD((prev) => ({ ...prev, ...patch }))
    setSucio(true)
  }, [])

  const cambiarModulo = useCallback((i: number, patch: Partial<Module>) => {
    setD((prev) => {
      const modules = [...prev.modules]
      modules[i] = { ...modules[i], ...patch }
      return { ...prev, modules }
    })
    setSucio(true)
  }, [])

  const idsUsados = useMemo(() => d.modules.map((m) => m.id), [d.modules])

  function agregarModulo() {
    const id = idDesdeTituloModulo('modulo', idsUsados)
    const nuevo: Module = {
      id,
      num: String(d.modules.length + 1).padStart(2, '0'),
      icon: 'file',
      dur: '',
      title: '',
      tag: '',
      lessons: [{ t: '', blocks: [{ type: 'p', v: '' }] }],
      quiz: [],
    }
    setD((p) => ({ ...p, modules: [...p.modules, nuevo] }))
    setAbiertos((s) => new Set([...s, id]))
    setSucio(true)
  }

  function moverModulo(i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= d.modules.length) return
    setD((p) => {
      const modules = [...p.modules]
      ;[modules[i], modules[j]] = [modules[j], modules[i]]
      return { ...p, modules: modules.map((m, k) => ({ ...m, num: String(k + 1).padStart(2, '0') })) }
    })
    setSucio(true)
  }

  function borrarModulo(i: number) {
    const m = d.modules[i]
    if (!confirm(`¿Quitar el módulo "${m.title || 'sin título'}" y todo lo que tiene dentro?`)) return
    setD((p) => ({
      ...p,
      modules: p.modules
        .filter((_, k) => k !== i)
        .map((mm, k) => ({ ...mm, num: String(k + 1).padStart(2, '0') })),
    }))
    setSucio(true)
  }

  /** Fija el id del modulo a partir de su titulo, solo si sigue siendo el provisional. */
  function fijarId(i: number) {
    const m = d.modules[i]
    if (!ID_PROVISIONAL.test(m.id) || !m.title.trim()) return
    const nuevo = idDesdeTituloModulo(
      m.title,
      idsUsados.filter((_, k) => k !== i),
    )
    if (nuevo === m.id) return
    cambiarModulo(i, { id: nuevo })
    setAbiertos((s) => {
      const n = new Set(s)
      n.delete(m.id)
      n.add(nuevo)
      return n
    })
  }

  async function enviar(action: 'guardar' | 'enviar') {
    setOcupado(true)
    setProblemas([])
    try {
      const res = await fetch(`/api/academy/courses/${cursoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          workspaceId,
          title: d.title,
          subtitle: d.subtitle,
          track: d.track,
          icon: d.icon,
          accent: d.accent,
          lang: d.lang,
          certName: d.certName,
          modules: d.modules,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (Array.isArray(json.problemas) && json.problemas.length > 0) {
          setProblemas(json.problemas)
          toast.error('Todavía falta algo. Abajo está la lista completa.')
          return
        }
        throw new Error(json.error || 'No se pudo guardar')
      }
      setSucio(false)
      if (action === 'enviar') {
        toast.success('Enviado a revisión. Te avisamos cuando haya respuesta.')
        router.push(volver)
      } else {
        toast.success('Guardado')
        router.refresh()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setOcupado(false)
    }
  }

  /**
   * Enviar guarda ANTES de pedir revisión. Si no, mandar a revisión lo escrito
   * hace diez minutos y perder lo de los últimos diez sería invisible: el API
   * validaría contra el cuerpo que le mandamos y la base guardaría otra cosa.
   * Como `enviar` manda el contenido completo en la misma llamada, una sola
   * petición basta y no hay ventana entre guardar y enviar.
   */
  const totalPreguntas = d.modules.reduce((n, m) => n + (m.quiz?.length ?? 0), 0)

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={volver} className="hover:text-foreground">
          Mis cursos
        </Link>
        <span>/</span>
        <span className="truncate">{d.title || 'Sin título'}</span>
      </div>

      <div className="sticky top-0 z-10 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-foreground">{d.title || 'Curso sin título'}</h1>
          <p className="text-xs text-muted-foreground">
            {courseId} · {d.modules.length === 1 ? '1 módulo' : `${d.modules.length} módulos`} ·{' '}
            {totalPreguntas === 1 ? '1 pregunta' : `${totalPreguntas} preguntas`}
            {sucio && <span className="ml-2 text-amber-600 dark:text-amber-400">sin guardar</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => enviar('guardar')}
            disabled={ocupado || !sucio}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar
          </button>
          <button
            type="button"
            onClick={() => enviar('enviar')}
            disabled={ocupado}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> Enviar a revisión
          </button>
        </div>
      </div>

      {estado === 'rejected' && reviewNote && (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
          <p className="text-sm font-semibold text-foreground">Por qué se devolvió</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{reviewNote}</p>
        </div>
      )}

      {problemas.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            {problemas.length === 1
              ? 'Falta 1 cosa antes de poder enviarlo'
              : `Faltan ${problemas.length} cosas antes de poder enviarlo`}
          </p>
          <ul className="mt-2 space-y-1.5">
            {problemas.map((p, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-foreground">{p.donde}:</span>{' '}
                <span className="text-muted-foreground">{p.que}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- Portada ---------- */}
      <section className="mb-6 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Portada
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-foreground">Título</span>
            <input
              className={claseInput}
              value={d.title}
              maxLength={120}
              onChange={(e) => cambiar({ title: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-foreground">
              Descripción corta
            </span>
            <input
              className={claseInput}
              value={d.subtitle}
              maxLength={240}
              placeholder="De qué va y para quién es"
              onChange={(e) => cambiar({ subtitle: e.target.value })}
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-foreground">Área</span>
            <input
              className={claseInput}
              value={d.track}
              maxLength={60}
              placeholder="Operaciones, Ventas, Equipo..."
              onChange={(e) => cambiar({ track: e.target.value })}
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium text-foreground">Idioma</span>
            <select
              className={claseInput}
              value={d.lang}
              onChange={(e) => cambiar({ lang: e.target.value as CourseLang })}
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-foreground">
              Nombre en el certificado
            </span>
            <input
              className={claseInput}
              value={d.certName}
              maxLength={160}
              placeholder="Se usa tal cual en el diploma"
              onChange={(e) => cambiar({ certName: e.target.value })}
            />
          </label>
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Icono y color</span>
            <div className="flex flex-wrap gap-1.5">
              {COLORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => cambiar({ accent: c })}
                  className={`h-7 w-7 rounded-full border-2 transition ${
                    d.accent.toLowerCase() === c.toLowerCase() ? 'border-foreground' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <select
              className={`${claseInput} mt-2`}
              value={d.icon}
              onChange={(e) => cambiar({ icon: e.target.value })}
            >
              {!ICONOS.includes(d.icon) && <option value={d.icon}>Icono actual</option>}
              {ICONOS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* ---------- Modulos ---------- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Contenido
          </h2>
          <button
            type="button"
            onClick={agregarModulo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" /> Módulo
          </button>
        </div>

        {d.modules.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Un curso son módulos. Cada módulo lleva lecciones y termina con un examen de al
              menos 3 preguntas: el avance solo se guarda al aprobarlo.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {d.modules.map((m, i) => (
            <ModuloEditor
              key={m.id}
              modulo={m}
              indice={i}
              total={d.modules.length}
              abierto={abiertos.has(m.id)}
              onAlternar={() =>
                setAbiertos((s) => {
                  const n = new Set(s)
                  if (n.has(m.id)) n.delete(m.id)
                  else n.add(m.id)
                  return n
                })
              }
              onCambiar={(patch) => cambiarModulo(i, patch)}
              onFijarId={() => fijarId(i)}
              onMover={(delta) => moverModulo(i, delta)}
              onBorrar={() => borrarModulo(i)}
            />
          ))}
        </div>
      </section>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Nadie ve este curso hasta que un admin lo apruebe.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ModuloEditor({
  modulo,
  indice,
  total,
  abierto,
  onAlternar,
  onCambiar,
  onFijarId,
  onMover,
  onBorrar,
}: {
  modulo: Module
  indice: number
  total: number
  abierto: boolean
  onAlternar: () => void
  onCambiar: (patch: Partial<Module>) => void
  onFijarId: () => void
  onMover: (delta: number) => void
  onBorrar: () => void
}) {
  const preguntas = modulo.quiz?.length ?? 0
  const faltanPreguntas = preguntas < 3

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={onAlternar}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {abierto ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="shrink-0 text-xs font-mono text-muted-foreground">{modulo.num}</span>
          <span className="truncate font-medium text-foreground">
            {modulo.title || 'Módulo sin título'}
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
              faltanPreguntas
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {preguntas === 1 ? '1 pregunta' : `${preguntas} preguntas`}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onMover(-1)}
            disabled={indice === 0}
            aria-label="Subir módulo"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMover(1)}
            disabled={indice === total - 1}
            aria-label="Bajar módulo"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onBorrar}
            aria-label="Quitar módulo"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-rose-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {abierto && (
        <div className="border-t border-border p-4">
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-sm font-medium text-foreground">
                Título del módulo
              </span>
              <input
                className={claseInput}
                value={modulo.title}
                maxLength={200}
                onBlur={onFijarId}
                onChange={(e) => onCambiar({ title: e.target.value })}
              />
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium text-foreground">
                Duración estimada
              </span>
              <input
                className={claseInput}
                value={modulo.dur}
                maxLength={40}
                placeholder="15 min"
                onChange={(e) => onCambiar({ dur: e.target.value })}
              />
            </label>
          </div>

          <LeccionesEditor
            lessons={modulo.lessons}
            onCambiar={(lessons) => onCambiar({ lessons })}
          />

          <QuizEditor quiz={modulo.quiz ?? []} onCambiar={(quiz) => onCambiar({ quiz })} />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function LeccionesEditor({
  lessons,
  onCambiar,
}: {
  lessons: Lesson[]
  onCambiar: (l: Lesson[]) => void
}) {
  function cambiarLeccion(i: number, patch: Partial<Lesson>) {
    onCambiar(lessons.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  }

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Lecciones</h3>
        <button
          type="button"
          onClick={() => onCambiar([...lessons, { t: '', blocks: [{ type: 'p', v: '' }] }])}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          <Plus className="h-3 w-3" /> Lección
        </button>
      </div>

      <div className="space-y-3">
        {lessons.map((l, i) => (
          <div key={i} className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center gap-2">
              <input
                className={claseInput}
                value={l.t}
                maxLength={200}
                placeholder={`Título de la lección ${i + 1}`}
                onChange={(e) => cambiarLeccion(i, { t: e.target.value })}
              />
              <button
                type="button"
                onClick={() => onCambiar(lessons.filter((_, k) => k !== i))}
                aria-label="Quitar lección"
                className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-rose-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <BloquesEditor
              blocks={l.blocks}
              onCambiar={(blocks) => cambiarLeccion(i, { blocks })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function BloquesEditor({
  blocks,
  onCambiar,
}: {
  blocks: Block[]
  onCambiar: (b: Block[]) => void
}) {
  function cambiar(i: number, patch: Partial<Block>) {
    onCambiar(blocks.map((b, k) => (k === i ? { ...b, ...patch } : b)))
  }

  function mover(i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= blocks.length) return
    const out = [...blocks]
    ;[out[i], out[j]] = [out[j], out[i]]
    onCambiar(out)
  }

  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const esLista = b.type === 'list' || b.type === 'ol'
        const texto = Array.isArray(b.v) ? b.v.join('\n') : (b.v ?? '')
        const tipo = TIPOS_BLOQUE.find((t) => t.v === b.type)
        return (
          <div key={i} className="rounded-lg border border-border/70 p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <select
                value={b.type}
                onChange={(e) => {
                  const nuevo = e.target.value as Block['type']
                  const esListaNueva = nuevo === 'list' || nuevo === 'ol'
                  cambiar(i, {
                    type: nuevo,
                    v: esListaNueva ? (Array.isArray(b.v) ? b.v : texto ? [texto] : ['']) : texto,
                  })
                }}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
              >
                {TIPOS_BLOQUE.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="flex-1 truncate text-[11px] text-muted-foreground">{tipo?.ayuda}</span>
              <button
                type="button"
                onClick={() => mover(i, -1)}
                disabled={i === 0}
                aria-label="Subir bloque"
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => mover(i, 1)}
                disabled={i === blocks.length - 1}
                aria-label="Bajar bloque"
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onCambiar(blocks.filter((_, k) => k !== i))}
                aria-label="Quitar bloque"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-rose-500"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            {b.type !== 'rule' && (
              <textarea
                value={texto}
                rows={esLista ? 4 : 3}
                placeholder={esLista ? 'Una por línea' : 'Escribe aquí'}
                onChange={(e) =>
                  cambiar(i, {
                    v: esLista ? e.target.value.split('\n') : e.target.value,
                  })
                }
                className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
              />
            )}
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => onCambiar([...blocks, { type: 'p', v: '' }])}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-3 w-3" /> Bloque
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function QuizEditor({
  quiz,
  onCambiar,
}: {
  quiz: QuizQuestion[]
  onCambiar: (q: QuizQuestion[]) => void
}) {
  function cambiar(i: number, patch: Partial<QuizQuestion>) {
    onCambiar(quiz.map((q, k) => (k === i ? { ...q, ...patch } : q)))
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Examen del módulo</h3>
        <button
          type="button"
          onClick={() =>
            onCambiar([...quiz, { q: '', opts: ['', ''], a: 0, ex: '' }])
          }
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          <Plus className="h-3 w-3" /> Pregunta
        </button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Mínimo 3. El avance solo se registra al aprobar el examen: un módulo sin examen no se
        puede completar nunca, así que el curso jamás llegaría al 100% ni daría certificado.
      </p>

      <div className="space-y-3">
        {quiz.map((q, i) => (
          <div key={i} className="rounded-lg border border-border/70 p-2.5">
            <div className="mb-2 flex items-start gap-2">
              <textarea
                value={q.q}
                rows={2}
                maxLength={1000}
                placeholder={`Pregunta ${i + 1}`}
                onChange={(e) => cambiar(i, { q: e.target.value })}
                className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => onCambiar(quiz.filter((_, k) => k !== i))}
                aria-label="Quitar pregunta"
                className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-rose-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Opciones (marca la correcta)
            </p>
            <div className="space-y-1.5">
              {q.opts.map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  {/* El radio ES la respuesta correcta. Un campo aparte con el
                      numero de la opcion es justo como se cuela un indice que
                      apunta a una opcion que ya no existe. */}
                  <input
                    type="radio"
                    name={`correcta-${i}-${q.q.slice(0, 8)}`}
                    checked={q.a === oi}
                    onChange={() => cambiar(i, { a: oi })}
                    aria-label={`Marcar opción ${oi + 1} como correcta`}
                    className="h-4 w-4 shrink-0 accent-emerald-500"
                  />
                  <input
                    value={o}
                    maxLength={600}
                    placeholder={`Opción ${oi + 1}`}
                    onChange={(e) =>
                      cambiar(i, { opts: q.opts.map((x, k) => (k === oi ? e.target.value : x)) })
                    }
                    className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    disabled={q.opts.length <= 2}
                    onClick={() => {
                      const opts = q.opts.filter((_, k) => k !== oi)
                      // Si se borra la correcta, o una anterior, el indice se
                      // recoloca aqui. Dejarlo quieto es exactamente el fallo
                      // que hace que el examen califique mal en silencio.
                      const a = q.a === oi ? 0 : q.a > oi ? q.a - 1 : q.a
                      cambiar(i, { opts, a })
                    }}
                    aria-label={`Quitar opción ${oi + 1}`}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-rose-500 disabled:opacity-30"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            {q.opts.length < 10 && (
              <button
                type="button"
                onClick={() => cambiar(i, { opts: [...q.opts, ''] })}
                className="mt-1.5 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> Opción
              </button>
            )}

            <label className="mt-2 block">
              <span className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <CheckCircle2 className="h-3 w-3" /> Por qué es la correcta
              </span>
              <textarea
                value={q.ex ?? ''}
                rows={2}
                maxLength={2000}
                placeholder="Sin esto, quien falla no aprende nada y quien acierta no sabe por qué"
                onChange={(e) => cambiar(i, { ex: e.target.value })}
                className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}
