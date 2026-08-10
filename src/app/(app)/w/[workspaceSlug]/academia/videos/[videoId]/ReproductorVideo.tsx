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
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, ListVideo, HelpCircle, RotateCcw, GitBranch, CornerUpLeft } from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'
import {
  esRamificacion,
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
  /** Video del que se vino por ramificacion, para poder regresar. */
  vieneDe: { id: string; title: string } | null
  /** Segundo de arranque pedido por la rama (query `t`). */
  arranqueEn: number | null
  /** Panel de certificacion, montado por el server debajo de la ficha. */
  children?: React.ReactNode
}

const INTERVALO_REPORTE = 15

export function ReproductorVideo({
  workspaceSlug, video, avance, streamUrl, posterUrl, vieneDe, arranqueEn, children,
}: Props) {
  const t = useT()
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  // El reporter vive en el efecto de montaje; se expone por ref para poder
  // llamarlo desde los handlers de ramificacion sin re-crear el efecto.
  const reportarRef = useRef<(() => Promise<void>) | null>(null)
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
    const opcion = activa.opts[idx]
    if (!opcion) return

    // En ramificacion (sin `a`) ninguna opcion es mala: toda opcion avanza.
    // En quiz, solo la correcta.
    const avanza = esRamificacion(activa) || idx === activa.a
    if (!avanza) {
      setFallo(idx)
      // Aun fallando, una opcion puede mandar a un video de refuerzo: eso es
      // mas util que solo decir "mal". Se navega igual.
      if (opcion.go) irAVideo(opcion)
      return
    }

    respondidasRef.current.add(activa.s)
    activaRef.current = null
    setActiva(null)
    setFallo(null)

    if (opcion.go) {
      irAVideo(opcion)
      return
    }
    if (typeof opcion.at === 'number') el.currentTime = opcion.at
    void el.play()
  }

  /**
   * Salta a otro video (ramificacion). Se reporta el avance ANTES de navegar:
   * si no, los segundos vistos hasta la bifurcacion se perderian en cada
   * salto, que en una historia con ramas son casi todos.
   */
  function irAVideo(opcion: { go?: string; at?: number }) {
    if (!opcion.go) return
    void reportarRef.current?.()
    const params = new URLSearchParams()
    params.set('de', video.id)
    if (typeof opcion.at === 'number') params.set('t', String(opcion.at))
    router.push(`/w/${workspaceSlug}/academia/videos/${opcion.go}?${params.toString()}`)
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

    // REINICIO AL CAMBIAR DE VIDEO. Al ramificar se navega a otra ruta, pero
    // React reusa esta misma instancia (mismo componente, misma posicion), asi
    // que los refs SOBREVIVEN. Sin esto, el video destino heredaria los
    // segundos vistos y las preguntas contestadas del anterior: se marcaria
    // como visto algo que nadie vio. No es hipotetico, es lo que pasa en cada
    // salto de rama.
    vistoRef.current = avance?.seconds_watched ?? 0
    sinReportarRef.current = 0
    respondidasRef.current = new Set()
    activaRef.current = null
    setActiva(null)
    setFallo(null)
    setCompletado(Boolean(avance?.completed))

    // El arranque pedido por la rama MANDA sobre el reanudar: si una opcion
    // dice "entra en el minuto 2", entrar donde lo dejaste la vez pasada
    // rompe la historia.
    if (arranqueEn !== null) {
      el.currentTime = arranqueEn
    } else {
      // Reanudar: solo si hay avance real y no esta al borde del final (retomar
      // en el ultimo 5% seria reanudar sobre los creditos).
      const dur = video.duration_seconds ?? 0
      const desde = avance?.last_position ?? 0
      if (desde > 5 && (dur === 0 || desde < dur * 0.95)) {
        el.currentTime = desde
      }
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

    reportarRef.current = () => reportar()

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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={`/w/${workspaceSlug}/academia/videos`}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> {t('academyV.backToGallery')}
          </Link>
          {/* Si se llego por una rama, la salida de vuelta tiene que existir:
              sin ella, una historia ramificada es un laberinto sin puerta. */}
          {vieneDe && (
            <Link
              href={`/w/${workspaceSlug}/academia/videos/${vieneDe.id}`}
              className="flex items-center gap-1.5 text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
            >
              <CornerUpLeft className="h-4 w-4" />
              {t('academyV.backToBranch')}: {vieneDe.title}
            </Link>
          )}
        </div>
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
              // overflow-y-auto: en un telefono el video 16:9 mide ~220px de
              // alto y una pregunta con 4+ opciones no cabe; sin scroll, las
              // opciones de abajo quedarian INALCANZABLES y el video pausado
              // para siempre. Visto en movil real con 3 opciones al limite.
              <div className="absolute inset-0 flex items-center justify-center overflow-y-auto rounded-xl bg-black/80 p-4">
                <div className="my-auto w-full max-w-md">
                  <p className="mb-3 flex items-start gap-2 text-sm font-semibold text-white sm:text-base">
                    {esRamificacion(activa)
                      ? <GitBranch className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
                      : <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />}
                    {activa.q}
                  </p>
                  <div className="space-y-2">
                    {activa.opts.map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => contestar(i)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                          fallo === i
                            ? 'border-red-500 bg-red-500/20 text-red-200'
                            : 'border-white/25 bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        <span>{opt.t}</span>
                        {/* La flecha avisa que esa opcion CAMBIA de video. Sin
                            ella, saltar de escena se siente como un fallo. */}
                        {opt.go && <GitBranch className="h-4 w-4 shrink-0 text-sky-300" />}
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
          {/* Panel de certificacion: va DEBAJO de la ficha, no arriba. El
              acuse tiene sentido despues de ver, y ponerlo antes invitaria a
              firmar sin haber visto nada. */}
          {children}
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
