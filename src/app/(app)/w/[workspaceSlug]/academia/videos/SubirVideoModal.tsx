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
  MAX_INTERACCIONES,
  THUMB_MIME_ALLOWLIST,
  VIDEO_MAX_BYTES,
  VIDEO_MIME_ALLOWLIST,
  parsearTiempo,
  type Capitulo,
  type Interaccion,
  type StackAcademia,
} from '@/lib/academy/videos'

interface Props {
  stacks: StackAcademia[]
  onClose: () => void
  onDone: () => void
}

interface FilaCapitulo {
  tiempo: string
  titulo: string
}

/** Interaccion en edicion: opciones separadas por | y correcta 1-based. */
interface FilaInteraccion {
  tiempo: string
  pregunta: string
  /**
   * Una opcion por linea. Para ramificar se escribe: Texto -> <id del video>
   * Se eligio una linea por opcion (y no separadas por |) justamente porque
   * ahora una opcion lleva id de video: en una sola linea con pipes se vuelve
   * ilegible al tercer destino.
   */
  opciones: string
  /** Vacio o 0 = ramificacion pura (ninguna opcion es la mala). */
  correcta: string
  explicacion: string
  rama: boolean
}

/**
 * Convierte el texto del editor a opciones. Una por linea; para ramificar,
 * `Texto -> <id del video>` y opcionalmente `@<segundo>`:
 *
 *   Entro a revisar     -> 3f1c...  @30
 *   Sigo sin revisar
 *
 * Se parte por la ULTIMA flecha, no por la primera: un texto de opcion puede
 * contener "->" legitimamente ("A -> B es el orden correcto") y partir por la
 * primera lo dejaria mutilado.
 */
export function parsearOpciones(texto: string): Array<{ t: string; go?: string; at?: number }> {
  const salida: Array<{ t: string; go?: string; at?: number }> = []
  for (const linea of texto.split('\n')) {
    const l = linea.trim()
    if (!l) continue
    const corte = l.lastIndexOf('->')
    if (corte === -1) {
      salida.push({ t: l })
      continue
    }
    const etiqueta = l.slice(0, corte).trim()
    let resto = l.slice(corte + 2).trim()
    let at: number | undefined
    const arroba = resto.lastIndexOf('@')
    if (arroba !== -1) {
      const n = parseInt(resto.slice(arroba + 1).trim(), 10)
      if (Number.isFinite(n) && n >= 0) at = n
      resto = resto.slice(0, arroba).trim()
    }
    const opcion: { t: string; go?: string; at?: number } = { t: etiqueta || l }
    if (resto) opcion.go = resto
    if (at !== undefined) opcion.at = at
    salida.push(opcion)
  }
  return salida
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

export function SubirVideoModal({ stacks, onClose, onDone }: Props) {
  const t = useT()
  const [archivo, setArchivo] = useState<File | null>(null)
  const [miniatura, setMiniatura] = useState<File | null>(null)
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [tags, setTags] = useState('')
  const [stackId, setStackId] = useState('')
  const [capitulos, setCapitulos] = useState<FilaCapitulo[]>([])
  const [interacciones, setInteracciones] = useState<FilaInteraccion[]>([])
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

    // Parsear capitulos e interacciones ANTES de subir 500MB: fallar barato.
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

    const preguntas: Interaccion[] = []
    for (const fila of interacciones) {
      if (!fila.tiempo.trim() && !fila.pregunta.trim()) continue
      const s = parsearTiempo(fila.tiempo)
      const opts = parsearOpciones(fila.opciones)
      // En ramificacion NO hay correcta: mandar `a` la convertiria en quiz y
      // todas las opciones menos una empezarian a rebotar.
      const a = fila.rama ? undefined : parseInt(fila.correcta, 10) - 1
      const aValida = fila.rama || (a !== undefined && a >= 0 && a < opts.length)
      if (s === null || !fila.pregunta.trim() || opts.length < 2 || !aValida) {
        toast.error(t('academyV.badInteraction'))
        return
      }
      const ex = fila.explicacion.trim()
      const it: Interaccion = { s, q: fila.pregunta.trim(), opts }
      if (a !== undefined) it.a = a
      if (ex) it.ex = ex
      preguntas.push(it)
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
          interactions: preguntas,
          tags: tags.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20),
          stackId: stackId || null,
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
            <span className="mb-1 block text-sm font-medium text-foreground">{t('academyV.stack')}</span>
            <select
              value={stackId}
              onChange={(e) => setStackId(e.target.value)}
              disabled={ocupado}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">{t('academyV.noStack')}</option>
              {stacks.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
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

          {/* Interacciones: preguntas que pausan el video */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t('academyV.interactions')}</span>
              <button
                onClick={() => setInteracciones((c) => (c.length < MAX_INTERACCIONES ? [...c, { tiempo: '', pregunta: '', opciones: '', correcta: '1', explicacion: '', rama: false }] : c))}
                disabled={ocupado}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
              >
                <Plus className="h-3.5 w-3.5" /> {t('academyV.addInteraction')}
              </button>
            </div>
            {interacciones.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('academyV.interactionsHint')}</p>
            )}
            <div className="space-y-3">
              {interacciones.map((fila, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={fila.tiempo}
                      onChange={(e) => setInteracciones((c) => c.map((f, j) => (j === i ? { ...f, tiempo: e.target.value } : f)))}
                      placeholder="0:30"
                      disabled={ocupado}
                      className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <input
                      value={fila.pregunta}
                      onChange={(e) => setInteracciones((c) => c.map((f, j) => (j === i ? { ...f, pregunta: e.target.value } : f)))}
                      placeholder={t('academyV.questionPlaceholder')}
                      disabled={ocupado}
                      className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <button
                      onClick={() => setInteracciones((c) => c.filter((_, j) => j !== i))}
                      disabled={ocupado}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                      aria-label={t('academyV.removeInteraction')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <textarea
                    value={fila.opciones}
                    onChange={(e) => setInteracciones((c) => c.map((f, j) => (j === i ? { ...f, opciones: e.target.value } : f)))}
                    placeholder={t('academyV.optionsPlaceholder')}
                    rows={3}
                    disabled={ocupado}
                    className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <label className="flex items-start gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={fila.rama}
                      onChange={(e) => setInteracciones((c) => c.map((f, j) => (j === i ? { ...f, rama: e.target.checked } : f)))}
                      disabled={ocupado}
                      className="mt-0.5 h-4 w-4 rounded border-border"
                    />
                    <span>
                      {t('academyV.branchMode')}
                      <span className="block text-[11px] text-muted-foreground">{t('academyV.branchModeHint')}</span>
                    </span>
                  </label>
                  {!fila.rama && (
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {t('academyV.correctLabel')}
                        <input
                          value={fila.correcta}
                          onChange={(e) => setInteracciones((c) => c.map((f, j) => (j === i ? { ...f, correcta: e.target.value } : f)))}
                          disabled={ocupado}
                          className="w-12 rounded-lg border border-border bg-background px-2 py-1 text-center text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                      </label>
                      <input
                        value={fila.explicacion}
                        onChange={(e) => setInteracciones((c) => c.map((f, j) => (j === i ? { ...f, explicacion: e.target.value } : f)))}
                        placeholder={t('academyV.explanationPlaceholder')}
                        disabled={ocupado}
                        className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                  )}
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
