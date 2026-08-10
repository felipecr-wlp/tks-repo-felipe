'use client'

/**
 * Subida de video (solo admin). El flujo respeta el limite de Vercel (~4.5MB
 * por request): el API solo FIRMA; el binario viaja navegador -> storage con
 * uploadToSignedUrl. La duracion se lee aqui, del metadata del propio archivo,
 * para que la tarjeta la muestre sin que nadie la teclee.
 *
 * Capitulos: filas "tiempo + titulo" (tiempo en mm:ss o h:mm:ss). Se validan
 * en el server con validarCapitulos; aqui solo se parsean.
 */
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { X, UploadCloud, Loader2, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/LanguageProvider'
import {
  MAX_CAPITULOS,
  THUMB_MIME_ALLOWLIST,
  VIDEO_MAX_BYTES,
  VIDEO_MIME_ALLOWLIST,
  parsearTiempo,
  type Capitulo,
} from '@/lib/academy/videos'

interface Props {
  onClose: () => void
  onDone: () => void
}

interface FilaCapitulo {
  tiempo: string
  titulo: string
}

/** Lee la duracion del archivo local sin subir nada. null si no se puede. */
function leerDuracion(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(v.duration) ? Math.round(v.duration) : null)
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    v.src = url
  })
}

async function pedirUploadUrl(file: File, kind: 'video' | 'thumb') {
  const res = await fetch('/api/academy/videos/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, mime: file.type, size: file.size, kind }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Error al preparar la subida')
  return json as { path: string; token: string; bucket: string }
}

export function SubirVideoModal({ onClose, onDone }: Props) {
  const t = useT()
  const [archivo, setArchivo] = useState<File | null>(null)
  const [miniatura, setMiniatura] = useState<File | null>(null)
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [tags, setTags] = useState('')
  const [capitulos, setCapitulos] = useState<FilaCapitulo[]>([])
  const [publicar, setPublicar] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Cerrar con Escape, como el resto de los modales de la app.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ocupado) onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, ocupado])

  function elegirVideo(f: File | null) {
    if (!f) return
    if (!VIDEO_MIME_ALLOWLIST.has(f.type)) {
      toast.error(t('academyV.badVideoType'))
      return
    }
    if (f.size > VIDEO_MAX_BYTES) {
      toast.error(t('academyV.tooBig'))
      return
    }
    setArchivo(f)
    if (!titulo.trim()) {
      // Prellenar el titulo con el nombre del archivo, sin extension.
      setTitulo(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim())
    }
  }

  async function guardar() {
    if (!archivo || !titulo.trim() || ocupado) return

    // Parsear capitulos ANTES de subir 500MB: fallar barato primero.
    const parseados: Capitulo[] = []
    for (const fila of capitulos) {
      if (!fila.tiempo.trim() && !fila.titulo.trim()) continue
      const s = parsearTiempo(fila.tiempo)
      if (s === null || !fila.titulo.trim()) {
        toast.error(t('academyV.badChapter'))
        return
      }
      parseados.push({ s, t: fila.titulo.trim() })
    }

    setOcupado(true)
    try {
      const supabase = createClient()
      const duracion = await leerDuracion(archivo)

      const firmaVideo = await pedirUploadUrl(archivo, 'video')
      const up1 = await supabase.storage
        .from(firmaVideo.bucket)
        .uploadToSignedUrl(firmaVideo.path, firmaVideo.token, archivo)
      if (up1.error) throw new Error(up1.error.message)

      let thumbnailPath: string | null = null
      if (miniatura && THUMB_MIME_ALLOWLIST.has(miniatura.type)) {
        const firmaThumb = await pedirUploadUrl(miniatura, 'thumb')
        const up2 = await supabase.storage
          .from(firmaThumb.bucket)
          .uploadToSignedUrl(firmaThumb.path, firmaThumb.token, miniatura)
        if (up2.error) throw new Error(up2.error.message)
        thumbnailPath = firmaThumb.path
      }

      const res = await fetch('/api/academy/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titulo.trim(),
          description: descripcion.trim(),
          path: firmaVideo.path,
          thumbnailPath,
          durationSeconds: duracion,
          chapters: parseados,
          tags: tags.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20),
          status: publicar ? 'live' : 'draft',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Error al registrar el video')

      toast.success(t('academyV.uploaded'))
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('academyV.uploadFailed'))
      setOcupado(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-background p-5 shadow-xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{t('academyV.uploadTitle')}</h2>
          <button
            onClick={onClose}
            disabled={ocupado}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40"
            aria-label={t('academyV.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-foreground">{t('academyV.file')}</span>
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              onChange={(e) => elegirVideo(e.target.files?.[0] ?? null)}
              disabled={ocupado}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/80"
            />
            {archivo && (
              <span className="mt-1 block text-xs text-muted-foreground">
                {archivo.name} · {(archivo.size / (1024 * 1024)).toFixed(1)} MB
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-foreground">{t('academyV.videoTitle')}</span>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={160}
              disabled={ocupado}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder={t('academyV.titlePlaceholder')}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-foreground">{t('academyV.description')}</span>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={2000}
              rows={2}
              disabled={ocupado}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-foreground">{t('academyV.tags')}</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={ocupado}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder={t('academyV.tagsPlaceholder')}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-foreground">{t('academyV.thumb')}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setMiniatura(e.target.files?.[0] ?? null)}
              disabled={ocupado}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/80"
            />
          </label>

          {/* Capitulos */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t('academyV.chapters')}</span>
              <button
                onClick={() => setCapitulos((c) => (c.length < MAX_CAPITULOS ? [...c, { tiempo: '', titulo: '' }] : c))}
                disabled={ocupado}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
              >
                <Plus className="h-3.5 w-3.5" /> {t('academyV.addChapter')}
              </button>
            </div>
            {capitulos.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('academyV.chaptersHint')}</p>
            )}
            <div className="space-y-2">
              {capitulos.map((fila, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={fila.tiempo}
                    onChange={(e) => setCapitulos((c) => c.map((f, j) => (j === i ? { ...f, tiempo: e.target.value } : f)))}
                    placeholder="0:00"
                    disabled={ocupado}
                    className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <input
                    value={fila.titulo}
                    onChange={(e) => setCapitulos((c) => c.map((f, j) => (j === i ? { ...f, titulo: e.target.value } : f)))}
                    placeholder={t('academyV.chapterTitle')}
                    disabled={ocupado}
                    className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    onClick={() => setCapitulos((c) => c.filter((_, j) => j !== i))}
                    disabled={ocupado}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                    aria-label={t('academyV.removeChapter')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={publicar}
              onChange={(e) => setPublicar(e.target.checked)}
              disabled={ocupado}
              className="h-4 w-4 rounded border-border"
            />
            {t('academyV.publishNow')}
          </label>

          {ocupado && (
            <p className="text-xs text-amber-600 dark:text-amber-500">{t('academyV.uploading')}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={ocupado}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40"
            >
              {t('academyV.cancel')}
            </button>
            <button
              onClick={guardar}
              disabled={!archivo || !titulo.trim() || ocupado}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {t('academyV.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
