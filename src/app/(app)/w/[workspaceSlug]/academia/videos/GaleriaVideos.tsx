'use client'

/**
 * Galeria de videos organizada por STACKS (colecciones tipo LMS: cada stack es
 * una seccion con su color, descripcion y avance). Arriba, un hero con las
 * cifras de la persona y el carril "Continuar viendo", que cruza stacks.
 *
 * Mobile-first: hero compacto, 1 columna en telefono, 2 en tablet, 3 en
 * desktop. Miniaturas con loading="lazy": el egress se paga por lo que se VE,
 * no por todo el catalogo.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Clapperboard, Plus, Search, CheckCircle2, Play, Clock3, FolderPlus, Layers,
} from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n/LanguageProvider'
import {
  agruparPorStack,
  formatearSegundos,
  ordenarVideosParaUsuario,
  porcentajeVisto,
  type AvanceVideo,
  type StackAcademia,
  type VideoAcademia,
  type VideoConAvance,
} from '@/lib/academy/videos'
import { SubirVideoModal } from './SubirVideoModal'

interface Props {
  workspaceSlug: string
  videos: VideoAcademia[]
  avances: AvanceVideo[]
  stacks: StackAcademia[]
  thumbUrls: Record<string, string>
  esAdmin: boolean
}

export function GaleriaVideos({ workspaceSlug, videos, avances, stacks, thumbUrls, esAdmin }: Props) {
  const t = useT()
  const router = useRouter()
  const [busqueda, setBusqueda] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [creandoStack, setCreandoStack] = useState(false)

  const tagsDisponibles = useMemo(() => {
    const s = new Set<string>()
    for (const v of videos) for (const x of v.tags) s.add(x)
    return Array.from(s).sort()
  }, [videos])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return videos.filter((v) => {
      if (tag && !v.tags.includes(tag)) return false
      if (!q) return true
      return (
        v.title.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        v.tags.some((x) => x.toLowerCase().includes(q))
      )
    })
  }, [videos, busqueda, tag])

  const { continuar, nuevos, vistos } = useMemo(
    () => ordenarVideosParaUsuario(filtrados, avances),
    [filtrados, avances],
  )
  const conAvance = useMemo(
    () => [...continuar, ...nuevos, ...vistos],
    [continuar, nuevos, vistos],
  )
  const secciones = useMemo(() => agruparPorStack(conAvance, stacks), [conAvance, stacks])

  const totalVistos = useMemo(
    () => videos.filter((v) => avances.some((a) => a.video_id === v.id && a.completed)).length,
    [videos, avances],
  )

  async function crearStack() {
    const nombre = window.prompt(t('academyV.newStackPrompt'))
    if (!nombre?.trim() || creandoStack) return
    setCreandoStack(true)
    try {
      const res = await fetch('/api/academy/stacks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nombre.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Error')
      toast.success(t('academyV.stackCreated'))
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('academyV.genericError'))
    } finally {
      setCreandoStack(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {/* Hero tipo LMS: identidad + cifras de la persona + busqueda */}
      <div className="mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-2xl font-bold sm:text-3xl">
              <Clapperboard className="h-7 w-7 text-amber-400" /> {t('academyV.title')}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-300">{t('academyV.subtitle')}</p>
          </div>
          {/* Sin shrink-0: en 390px el boton de subir se salia de la pantalla
              en vez de envolver a la siguiente linea. Visto en movil real. */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/w/${workspaceSlug}/academia`}
              className="rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-white hover:bg-white/10"
            >
              {t('academyV.backToCourses')}
            </Link>
            {esAdmin && (
              <>
                <button
                  onClick={crearStack}
                  disabled={creandoStack}
                  className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-50"
                >
                  <FolderPlus className="h-4 w-4" /> {t('academyV.newStack')}
                </button>
                <button
                  onClick={() => setSubiendo(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400"
                >
                  <Plus className="h-4 w-4" /> {t('academyV.upload')}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <span className="flex items-center gap-2">
            <Play className="h-4 w-4 text-amber-400" />
            <strong>{videos.length}</strong> {t('academyV.statVideos')}
          </span>
          <span className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-amber-400" />
            <strong>{stacks.length}</strong> {t('academyV.statStacks')}
          </span>
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <strong>{totalVistos}/{videos.length}</strong> {t('academyV.statWatched')}
          </span>
        </div>

        <div className="relative mt-5 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={t('academyV.searchPlaceholder')}
            className="w-full rounded-lg border border-white/15 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          />
        </div>
      </div>

      {tagsDisponibles.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {tagsDisponibles.map((x) => (
            <button
              key={x}
              onClick={() => setTag(tag === x ? null : x)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                tag === x
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {x}
            </button>
          ))}
        </div>
      )}

      {videos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Clapperboard className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {esAdmin ? t('academyV.emptyAdmin') : t('academyV.empty')}
          </p>
        </div>
      ) : (
        <>
          {continuar.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('academyV.continueRail')}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {continuar.map((v) => (
                  <Tarjeta key={v.id} v={v} slug={workspaceSlug} thumb={thumbUrls[v.id]} />
                ))}
              </div>
            </section>
          )}

          {secciones.map((sec) => (
            <SeccionDeStack
              key={sec.stack?.id ?? '__sueltos__'}
              stack={sec.stack}
              lista={sec.videos}
              slug={workspaceSlug}
              thumbs={thumbUrls}
            />
          ))}

          {conAvance.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('academyV.noResults')}</p>
          )}
        </>
      )}

      {subiendo && (
        <SubirVideoModal
          stacks={stacks}
          onClose={() => setSubiendo(false)}
          onDone={() => {
            setSubiendo(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function SeccionDeStack({
  stack, lista, slug, thumbs,
}: {
  stack: StackAcademia | null
  lista: VideoConAvance[]
  slug: string
  thumbs: Record<string, string>
}) {
  const t = useT()
  const vistos = lista.filter((v) => v.avance?.completed).length
  return (
    <section className="mb-10">
      <div
        className="mb-4 border-l-4 pl-3"
        style={{ borderColor: stack?.accent ?? 'var(--border, #e2e8f0)' }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-foreground">
            {stack?.title ?? t('academyV.unstacked')}
          </h2>
          <span className="text-xs font-medium text-muted-foreground">
            {vistos}/{lista.length} {t('academyV.statWatched')}
          </span>
        </div>
        {stack?.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{stack.description}</p>
        )}
        {/* Barra de avance del stack, estilo LMS */}
        <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${lista.length > 0 ? Math.round((vistos / lista.length) * 100) : 0}%`,
              backgroundColor: stack?.accent ?? '#94a3b8',
            }}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lista.map((v) => (
          <Tarjeta key={v.id} v={v} slug={slug} thumb={thumbs[v.id]} />
        ))}
      </div>
    </section>
  )
}

function Tarjeta({ v, slug, thumb }: { v: VideoConAvance; slug: string; thumb?: string }) {
  const t = useT()
  const pct = porcentajeVisto(v)
  return (
    <Link
      href={`/w/${slug}/academia/videos/${v.id}`}
      className="group overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-video bg-muted">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal; next/image no optimiza origenes firmados
          <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Play className="h-10 w-10 text-muted-foreground/50" />
          </div>
        )}
        {v.status === 'draft' && (
          <span className="absolute left-2 top-2 rounded bg-amber-500/90 px-2 py-0.5 text-[11px] font-semibold text-white">
            {t('academyV.draft')}
          </span>
        )}
        {v.interactions.length > 0 && (
          <span className="absolute right-2 top-2 rounded bg-sky-600/90 px-2 py-0.5 text-[11px] font-semibold text-white">
            {t('academyV.interactive')}
          </span>
        )}
        {v.duration_seconds != null && v.duration_seconds > 0 && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
            <Clock3 className="h-3 w-3" /> {formatearSegundos(v.duration_seconds)}
          </span>
        )}
        {pct > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-semibold text-foreground group-hover:text-primary">
            {v.title}
          </h3>
          {v.avance?.completed && (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          )}
        </div>
        {v.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {v.tags.slice(0, 3).map((x) => (
              <span key={x} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {x}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
