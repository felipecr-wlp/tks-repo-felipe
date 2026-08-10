'use client'

/**
 * Reproductor con capitulos, reanudacion y avance.
 *
 * Como se mide "visto": un contador suma UN segundo por tick de reloj mientras
 * el video reproduce (no la posicion de la barra: saltar al final no cuenta
 * como ver). El server ademas lo guarda monotonico y deriva `completed`, asi
 * que el cliente puede mentirse a si mismo pero no a la base.
 *
 * Cuando se reporta: cada 15s reproduciendo, al pausar, al terminar, y al
 * cerrar/ocultar la pestana con sendBeacon (fetch normal muere con la pagina;
 * el beacon sobrevive, y ese ultimo reporte es justo el del "me fui a mitad
 * del video", el que hace funcionar el reanudar).
 *
 * Mobile-first: video arriba a lo ancho; capitulos debajo en telefono y en
 * columna lateral en desktop.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, ListVideo, HelpCircle, RotateCcw } from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'
import {
  formatearSegundos,
  type AvanceVideo,
  type Interaccion,
  type VideoAcademia,
} from '@/lib/academy/videos'

interface Props {
  workspaceSlug: string
  video: VideoAcademia
  avance: AvanceVideo | null
  streamUrl: string
  posterUrl: string | null
}

const INTERVALO_REPORTE = 15

export function ReproductorVideo({ workspaceSlug, video, avance, streamUrl, posterUrl }: Props) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [posicion, setPosicion] = useState(0)
  const [completado, setCompletado] = useState(Boolean(avance?.completed))

  // Acumuladores en refs: cambian cada segundo y no deben repintar nada.
  const vistoRef = useRef(avance?.seconds_watched ?? 0)
  const sinReportarRef = useRef(0)

  // Interactividad: pregunta activa (pausa el video) + las ya contestadas.
  // Las contestadas van en ref porque se consultan desde el handler de
  // timeupdate, que vive en el efecto de montaje.
  const [activa, setActiva] = useState<Interaccion | null>(null)
  const [fallo, setFallo] = useState<number | null>(null)
  const activaRef = useRef<Interaccion | null>(null)
  const respondidasRef = useRef<Set<number>>(new Set())

  function contestar(idx: number) {
    const el = videoRef.current
    if (!activa || !el) return
    if (idx === activa.a) {
      respondidasRef.current.add(activa.s)
      activaRef.current = null
      setActiva(null)
      setFallo(null)
      void el.play()
    } else {
      setFallo(idx)
    }
  }

  function volverAVer() {
    const el = videoRef.current
    if (!activa || !el) return
    // No se marca como respondida: al volver a pasar por el segundo, la
    // pregunta reaparece. Ese es el punto: repasar y volver a intentar.
    el.currentTime = Math.max(0, activa.s - 15)
    activaRef.current = null
    setActiva(null)
    setFallo(null)
    void el.play()
  }

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    // Reanudar: solo si hay avance real y no esta al borde del final (retomar
    // en el ultimo 5% seria reanudar sobre los creditos).
    const dur = video.duration_seconds ?? 0
    const desde = avance?.last_position ?? 0
    if (desde > 5 && (dur === 0 || desde < dur * 0.95)) {
      el.currentTime = desde
    }

    const cuerpo = (ended: boolean) =>
      JSON.stringify({
        position: Math.floor(el.currentTime),
        watched: Math.floor(vistoRef.current),
        ended,
      })

    async function reportar(ended = false) {
      sinReportarRef.current = 0
      try {
        const res = await fetch(`/api/academy/videos/${video.id}/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: cuerpo(ended),
          keepalive: true,
        })
        const json = await res.json().catch(() => null)
        if (json?.completed) setCompletado(true)
      } catch {
        // Sin red no se pierde nada critico: el contador local sigue y el
        // proximo reporte lleva el acumulado (watched es monotonico alla).
      }
    }

    // Un segundo de reloj por tick mientras reproduce.
    const tick = window.setInterval(() => {
      if (!el.paused && !el.ended) {
        vistoRef.current += 1
        sinReportarRef.current += 1
        if (sinReportarRef.current >= INTERVALO_REPORTE) void reportar()
      }
    }, 1000)

    const onPause = () => void reportar()
    const onEnded = () => void reportar(true)
    const onTime = () => {
      setPosicion(el.currentTime)
      // Interactividad: al cruzar el segundo de una pregunta sin contestar,
      // pausar y mostrarla. Buscar la MAS TEMPRANA sin contestar tambien
      // cubre el salto con la barra: adelantarse no se salta las preguntas.
      if (!activaRef.current) {
        const pendiente = video.interactions.find(
          (it) => !respondidasRef.current.has(it.s) && el.currentTime >= it.s,
        )
        if (pendiente) {
          el.pause()
          activaRef.current = pendiente
          setActiva(pendiente)
          setFallo(null)
        }
      }
    }

    // Ultimo aliento al cerrar u ocultar: beacon, no fetch.
    const onHide = () => {
      if (document.visibilityState === 'visible') return
      navigator.sendBeacon(
        `/api/academy/videos/${video.id}/progress`,
        new Blob([cuerpo(false)], { type: 'application/json' }),
      )
    }

    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    el.addEventListener('timeupdate', onTime)
    document.addEventListener('visibilitychange', onHide)

    return () => {
      window.clearInterval(tick)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('timeupdate', onTime)
      document.removeEventListener('visibilitychange', onHide)
    }
    // avance/duration solo se leen al montar: reanudar dos veces seria saltar
    // al usuario de lugar a mitad de reproduccion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id])

  function irA(segundo: number) {
    const el = videoRef.current
    if (!el) return
    el.currentTime = segundo
    void el.play()
  }

  const capituloActivo = [...video.chapters].reverse().find((c) => posicion >= c.s)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href={`/w/${workspaceSlug}/academia/videos`}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t('academyV.backToGallery')}
        </Link>
        {completado && (
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t('academyV.completed')}
          </span>
        )}
      </div>

      <div className="gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          {/* aspect-video fija el alto ANTES de cargar metadata: sin brinco de layout */}
          <div className="relative">
            <video
              ref={videoRef}
              src={streamUrl}
              poster={posterUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded-xl bg-black"
            />
            {activa && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/80 p-4">
                <div className="w-full max-w-md">
                  <p className="mb-3 flex items-start gap-2 text-sm font-semibold text-white sm:text-base">
                    <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                    {activa.q}
                  </p>
                  <div className="space-y-2">
                    {activa.opts.map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => contestar(i)}
                        className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                          fallo === i
                            ? 'border-red-500 bg-red-500/20 text-red-200'
                            : 'border-white/25 bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  {fallo !== null && (
                    <div className="mt-3 rounded-lg bg-white/10 p-3">
                      {activa.ex && <p className="text-sm text-slate-200">{activa.ex}</p>}
                      <button
                        onClick={volverAVer}
                        className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-amber-400"
                      >
                        <RotateCcw className="h-4 w-4" /> {t('academyV.rewatch')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <h1 className="mt-4 text-xl font-bold text-foreground">{video.title}</h1>
          {video.description && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {video.description}
            </p>
          )}
          {video.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {video.tags.map((x) => (
                <span key={x} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                  {x}
                </span>
              ))}
            </div>
          )}
        </div>

        {video.chapters.length > 0 && (
          <aside className="mt-6 lg:mt-0">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <ListVideo className="h-4 w-4" /> {t('academyV.chapters')}
            </h2>
            <ol className="overflow-hidden rounded-xl border border-border">
              {video.chapters.map((c) => {
                const activo = capituloActivo?.s === c.s
                return (
                  <li key={c.s}>
                    <button
                      onClick={() => irA(c.s)}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                        activo
                          ? 'bg-primary/10 font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <span className={`shrink-0 font-mono text-xs ${activo ? 'text-primary' : ''}`}>
                        {formatearSegundos(c.s)}
                      </span>
                      <span className="line-clamp-2">{c.t}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </aside>
        )}
      </div>
    </div>
  )
}
