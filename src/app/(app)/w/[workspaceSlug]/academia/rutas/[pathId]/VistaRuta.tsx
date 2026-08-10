'use client'

/**
 * Mapa de una ruta: el arbol de decisiones dibujado como lista sangrada, con
 * lo que ya viste marcado y un boton grande de "continuar por aqui".
 *
 * Se eligio lista sangrada y no un diagrama con lineas curvas por una razon
 * concreta: esto se ve en un telefono en obra. Un diagrama bonito obliga a
 * hacer zoom y arrastrar; una lista se lee con el pulgar.
 */
import Link from 'next/link'
import {
  ArrowLeft, CheckCircle2, Circle, Play, CornerDownRight,
  AlertTriangle, RotateCcw, Route as RouteIcon,
} from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'
import { aplanar, type NodoRuta, type ResumenRuta } from '@/lib/academy/rutas'
import type { RutaAcademia } from '@/lib/academy/videos'

interface Props {
  workspaceSlug: string
  ruta: RutaAcademia
  resumen: ResumenRuta
  siguienteId: string | null
  esAdmin: boolean
}

export function VistaRuta({ workspaceSlug, ruta, resumen, siguienteId, esAdmin }: Props) {
  const t = useT()
  const pasos = aplanar(resumen.raiz)
  const pct = resumen.totalVideos > 0
    ? Math.round((resumen.vistos / resumen.totalVideos) * 100)
    : 0

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Link
        href={`/w/${workspaceSlug}/academia/videos`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t('academyV.backToGallery')}
      </Link>

      <div
        className="mb-6 rounded-2xl p-6 text-white sm:p-8"
        style={{ background: `linear-gradient(135deg, ${ruta.accent}, #0f172a)` }}
      >
        <h1 className="flex items-start gap-2.5 text-2xl font-bold sm:text-3xl">
          <RouteIcon className="mt-1 h-7 w-7 shrink-0" /> {ruta.title}
        </h1>
        {ruta.description && <p className="mt-2 text-sm text-white/80">{ruta.description}</p>}

        {ruta.status !== 'live' && (
          <span className="mt-3 inline-block rounded bg-amber-500/90 px-2 py-0.5 text-[11px] font-semibold">
            {t('academyV.draft')}
          </span>
        )}

        {resumen.totalVideos > 0 && (
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span>{resumen.vistos}/{resumen.totalVideos} {t('academyV.statWatched')}</span>
              <strong>{pct}%</strong>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-white transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {siguienteId ? (
          <Link
            href={`/w/${workspaceSlug}/academia/videos/${siguienteId}`}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-white/90"
          >
            <Play className="h-4 w-4" />
            {resumen.vistos === 0 ? t('academyR.start') : t('academyR.continue')}
          </Link>
        ) : resumen.totalVideos > 0 ? (
          <p className="mt-5 flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-5 w-5" /> {t('academyR.finished')}
          </p>
        ) : null}
      </div>

      {/* Una ruta sin entrada es una puerta que no abre: hay que decirlo, no
          enseñar una pantalla vacia que parece un error de carga. */}
      {!ruta.entry_video_id && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t('academyR.noEntry')}
        </p>
      )}

      {resumen.rotos > 0 && esAdmin && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t('academyR.broken')}: {resumen.rotos}
        </p>
      )}

      {resumen.raiz?.video && (
        <>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('academyR.map')}
          </h2>
          <div className="space-y-1">
            <Fila nodo={resumen.raiz} slug={workspaceSlug} esSiguiente={resumen.raiz.videoId === siguienteId} />
            {pasos.map((n, i) => (
              <Fila
                key={`${n.videoId}-${n.nivel}-${i}`}
                nodo={n}
                slug={workspaceSlug}
                esSiguiente={n.videoId === siguienteId}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Fila({ nodo, slug, esSiguiente }: { nodo: NodoRuta; slug: string; esSiguiente: boolean }) {
  const t = useT()
  // Sangria por nivel, con tope: mas alla de 6 niveles en un telefono ya no
  // queda ancho para el texto, y perder el titulo es peor que perder la
  // jerarquia exacta.
  const sangria = Math.min(nodo.nivel, 6) * 16

  const contenido = (
    <div
      className={`flex items-start gap-2 rounded-lg border p-2.5 transition-colors ${
        esSiguiente
          ? 'border-primary bg-primary/5'
          : 'border-transparent hover:border-border hover:bg-muted/50'
      }`}
    >
      {nodo.visto
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />}
      <div className="min-w-0 flex-1">
        {nodo.etiqueta && (
          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <CornerDownRight className="h-3 w-3 shrink-0" /> {nodo.etiqueta}
          </p>
        )}
        <p className={`truncate text-sm ${nodo.video ? 'text-foreground' : 'italic text-red-600 dark:text-red-400'}`}>
          {nodo.video?.title ?? t('academyR.missingVideo')}
        </p>
      </div>
      {nodo.ciclo && (
        <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          <RotateCcw className="h-3 w-3" /> {t('academyR.loop')}
        </span>
      )}
      {esSiguiente && (
        <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
          {t('academyR.here')}
        </span>
      )}
    </div>
  )

  // Un nodo de ciclo NO enlaza: ya esta mas arriba en el mapa, y darle enlace
  // haria creer que es contenido nuevo.
  if (!nodo.video || nodo.ciclo) {
    return <div style={{ marginLeft: sangria }}>{contenido}</div>
  }
  return (
    <Link href={`/w/${slug}/academia/videos/${nodo.videoId}`} className="block" style={{ marginLeft: sangria }}>
      {contenido}
    </Link>
  )
}
