'use client'

/**
 * Galeria de videos: tres carriles automaticos (continuar / nuevos / vistos,
 * reglas transparentes en ordenarVideosParaUsuario), busqueda y filtro por
 * etiqueta. Mobile-first: 1 columna en telefono, 2 en tablet, 3 en desktop.
 *
 * El admin sube videos desde aqui (modal): el binario va DIRECTO a storage con
 * URL firmada, nunca por la serverless function.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Clapperboard, Plus, Search, CheckCircle2, Play, Clock3 } from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'
import {
  formatearSegundos,
  ordenarVideosParaUsuario,
  porcentajeVisto,
  type AvanceVideo,
  type VideoAcademia,
  type VideoConAvance,
} from '@/lib/academy/videos'
import { SubirVideoModal } from './SubirVideoModal'

interface Props {
  workspaceSlug: string
  videos: VideoAcademia[]
  avances: AvanceVideo[]
  thumbUrls: Record<string, string>
  esAdmin: boolean
}

export function GaleriaVideos({ workspaceSlug, videos, avances, thumbUrls, esAdmin }: Props) {
  const t = useT()
  const router = useRouter()
  const [busqueda, setBusqueda] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)

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

  const hayFiltro = busqueda.trim().length > 0 || tag !== null

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Clapperboard className="h-6 w-6" /> {t('academyV.title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('academyV.subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/w/${workspaceSlug}/academia`}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            {t('academyV.backToCourses')}
          </Link>
          {esAdmin && (
            <button
              onClick={() => setSubiendo(true)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> {t('academyV.upload')}
            </button>
          )}
        </div>
      </div>

      {/* Busqueda + tags */}
      <div className="mb-6 space-y-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={t('academyV.searchPlaceholder')}
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        {tagsDisponibles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
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
      </div>

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
            <Carril titulo={t('academyV.continueRail')} lista={continuar} slug={workspaceSlug} thumbs={thumbUrls} />
          )}
          {nuevos.length > 0 && (
            <Carril
              titulo={hayFiltro ? t('academyV.resultsRail') : t('academyV.newRail')}
              lista={nuevos}
              slug={workspaceSlug}
              thumbs={thumbUrls}
            />
          )}
          {vistos.length > 0 && (
            <Carril titulo={t('academyV.watchedRail')} lista={vistos} slug={workspaceSlug} thumbs={thumbUrls} />
          )}
          {continuar.length + nuevos.length + vistos.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('academyV.noResults')}</p>
          )}
        </>
      )}

      {subiendo && (
        <SubirVideoModal
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

function Carril({
  titulo, lista, slug, thumbs,
}: {
  titulo: string
  lista: VideoConAvance[]
  slug: string
  thumbs: Record<string, string>
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h2>
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
          <img src={thumb} alt="" className="h-full w-full object-cover" />
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
