'use client'

/**
 * Bloque de video dentro de una leccion: referencia por id a un video de la
 * galeria (academy_videos). El curso NO duplica el binario ni la URL: pide una
 * URL firmada fresca al reproducir, igual que la galeria. Si el video se
 * borra o se despublica, el bloque lo dice en claro en vez de girar infinito.
 */
import { useEffect, useState } from 'react'
import { Play, VideoOff, Loader2 } from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'

export function BloqueVideo({ videoId }: { videoId: string }) {
  const t = useT()
  const [url, setUrl] = useState<string | null>(null)
  const [poster, setPoster] = useState<string | null>(null)
  const [estado, setEstado] = useState<'idle' | 'cargando' | 'listo' | 'error'>('idle')

  // La URL se pide al dar play, no al montar: una leccion con tres videos no
  // debe firmar tres URLs que quiza nadie reproduzca.
  async function cargar() {
    if (estado === 'cargando' || estado === 'listo') return
    setEstado('cargando')
    try {
      const res = await fetch(`/api/academy/videos/${videoId}/stream`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Error')
      setUrl(json.url)
      setPoster(json.thumbnailUrl ?? null)
      setEstado('listo')
    } catch {
      setEstado('error')
    }
  }

  // Reintento suave si el id viene vacio o mal: bloque inerte, no crash.
  useEffect(() => {
    if (!videoId) setEstado('error')
  }, [videoId])

  if (estado === 'error') {
    return (
      <div className="my-4 flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/40">
        <VideoOff className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('academyV.blockUnavailable')}</p>
      </div>
    )
  }

  if (estado !== 'listo') {
    return (
      <button
        onClick={cargar}
        className="group relative my-4 flex aspect-video w-full items-center justify-center rounded-xl bg-black/90 transition-colors hover:bg-black"
        aria-label={t('academyV.playBlock')}
      >
        {estado === 'cargando' ? (
          <Loader2 className="h-10 w-10 animate-spin text-white/80" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 transition-transform group-hover:scale-110">
            <Play className="ml-1 h-8 w-8 text-white" />
          </span>
        )}
      </button>
    )
  }

  return (
    <video
      src={url ?? undefined}
      poster={poster ?? undefined}
      controls
      autoPlay
      playsInline
      preload="metadata"
      className="my-4 aspect-video w-full rounded-xl bg-black"
    />
  )
}
