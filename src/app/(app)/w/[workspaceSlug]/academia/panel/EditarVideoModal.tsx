'use client'

/**
 * Editor de un video YA SUBIDO: capitulos, preguntas, ramificacion,
 * certificacion y audiencia.
 *
 * POR QUE EXISTE. Hasta ahora todo eso solo se podia definir en el momento de
 * subir. Si te equivocabas en un segundo, o querias agregar una pregunta
 * despues, la unica salida era borrar el video y volver a subirlo: perdiendo
 * el avance de quien ya lo habia visto. Construir una academia asi es
 * imposible, porque el contenido bueno se afina, no sale bien a la primera.
 *
 * NO cambia el archivo de video. Reemplazar el binario es subir otro video,
 * no mutar este: el avance de la gente pertenece a LO QUE VIERON.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { X, Save, Loader2, Plus, Trash2, GitBranch, HelpCircle } from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'
import {
  MAX_CAPITULOS, MAX_INTERACCIONES, parsearTiempo, formatearSegundos,
  type Capitulo, type Interaccion, type VideoAcademia,
} from '@/lib/academy/videos'
import { parsearOpciones } from '../videos/SubirVideoModal'

interface Props {
  video: VideoAcademia
  /** Para poder ofrecer destinos por NOMBRE en vez de pedir uuid a mano. */
  otrosVideos: Array<{ id: string; title: string }>
  onClose: () => void
  onGuardado: () => void
}

interface FilaCap { tiempo: string; titulo: string }
interface FilaInt {
  tiempo: string
  pregunta: string
  opciones: string
  correcta: string
  explicacion: string
  rama: boolean
}

export function EditarVideoModal({ video, otrosVideos, onClose, onGuardado }: Props) {
  const t = useT()
  const [titulo, setTitulo] = useState(video.title)
  const [descripcion, setDescripcion] = useState(video.description)
  const [caps, setCaps] = useState<FilaCap[]>(
    video.chapters.map((c) => ({ tiempo: formatearSegundos(c.s), titulo: c.t })),
  )
  const [ints, setInts] = useState<FilaInt[]>(
    video.interactions.map((it) => ({
      tiempo: formatearSegundos(it.s),
      pregunta: it.q,
      // Se re-serializa a la MISMA sintaxis del editor de subida, para que
      // quien aprendio una no tenga que aprender otra.
      opciones: it.opts
        .map((o) => o.t + (o.go ? ` -> ${o.go}` : '') + (o.at !== undefined ? ` @${o.at}` : ''))
        .join('\n'),
      correcta: it.a !== undefined ? String(it.a + 1) : '1',
      explicacion: it.ex ?? '',
      rama: it.a === undefined,
    })),
  )
  const [exigeAcuse, setExigeAcuse] = useState(video.requires_ack)
  const [exigeFirma, setExigeFirma] = useState(video.requires_verification)
  const [meses, setMeses] = useState(video.valid_months ? String(video.valid_months) : '')
  const [textoAcuse, setTextoAcuse] = useState(video.ack_text ?? '')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !guardando) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, guardando])

  async function guardar() {
    if (guardando || !titulo.trim()) return

    const capitulos: Capitulo[] = []
    for (const f of caps) {
      if (!f.tiempo.trim() && !f.titulo.trim()) continue
      const s = parsearTiempo(f.tiempo)
      if (s === null || !f.titulo.trim()) { toast.error(t('academyV.badChapter')); return }
      capitulos.push({ s, t: f.titulo.trim() })
    }

    const preguntas: Interaccion[] = []
    for (const f of ints) {
      if (!f.tiempo.trim() && !f.pregunta.trim()) continue
      const s = parsearTiempo(f.tiempo)
      const opts = parsearOpciones(f.opciones)
      const a = f.rama ? undefined : parseInt(f.correcta, 10) - 1
      const aOk = f.rama || (a !== undefined && a >= 0 && a < opts.length)
      if (s === null || !f.pregunta.trim() || opts.length < 2 || !aOk) {
        toast.error(t('academyV.badInteraction')); return
      }
      const it: Interaccion = { s, q: f.pregunta.trim(), opts }
      if (a !== undefined) it.a = a
      if (f.explicacion.trim()) it.ex = f.explicacion.trim()
      preguntas.push(it)
    }

    setGuardando(true)
    try {
      const res = await fetch(`/api/academy/videos/${video.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titulo.trim(),
          description: descripcion.trim(),
          chapters: capitulos,
          interactions: preguntas,
          requiresAck: exigeAcuse,
          requiresVerification: exigeFirma,
          validMonths: meses.trim() ? Number(meses) : null,
          ackText: textoAcuse.trim() || null,
        }),
      })
      const json = await res.json()
      // El server explica POR QUE (destino inexistente, pregunta imposible):
      // su mensaje vale mas que uno generico.
      if (!res.ok) throw new Error(json.error ?? 'Error')
      toast.success(t('academyE.saved'))
      onGuardado()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('academyV.genericError'), { duration: 10000 })
      setGuardando(false)
    }
  }

  /** Inserta el id del video elegido al final del cuadro de opciones. */
  function agregarDestino(i: number, destinoId: string) {
    if (!destinoId) return
    const v = otrosVideos.find((x) => x.id === destinoId)
    setInts((c) => c.map((f, j) => j === i
      ? { ...f, opciones: (f.opciones.trimEnd() + `\n${v?.title ?? 'Opción'} -> ${destinoId}`).trim() }
      : f))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-background p-5 shadow-xl sm:max-w-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t('academyE.title')}</h2>
          <button onClick={onClose} disabled={guardando}
            className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={t('academyV.cancel')}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-foreground">{t('academyV.videoTitle')}</span>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} disabled={guardando}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-foreground">{t('academyV.description')}</span>
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} disabled={guardando}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </label>

          {/* CAPITULOS */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t('academyV.chapters')}</span>
              <button onClick={() => setCaps((c) => c.length < MAX_CAPITULOS ? [...c, { tiempo: '', titulo: '' }] : c)}
                disabled={guardando} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10">
                <Plus className="h-3.5 w-3.5" /> {t('academyV.addChapter')}
              </button>
            </div>
            <div className="space-y-2">
              {caps.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={f.tiempo} onChange={(e) => setCaps((c) => c.map((x, j) => j === i ? { ...x, tiempo: e.target.value } : x))}
                    placeholder="1:30" disabled={guardando}
                    className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                  <input value={f.titulo} onChange={(e) => setCaps((c) => c.map((x, j) => j === i ? { ...x, titulo: e.target.value } : x))}
                    placeholder={t('academyV.chapterTitle')} disabled={guardando}
                    className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                  <button onClick={() => setCaps((c) => c.filter((_, j) => j !== i))} disabled={guardando}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </div>

          {/* PREGUNTAS */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t('academyV.interactions')}</span>
              <button onClick={() => setInts((c) => c.length < MAX_INTERACCIONES ? [...c, { tiempo: '', pregunta: '', opciones: '', correcta: '1', explicacion: '', rama: false }] : c)}
                disabled={guardando} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10">
                <Plus className="h-3.5 w-3.5" /> {t('academyV.addChapter')}
              </button>
            </div>
            <div className="space-y-3">
              {ints.map((f, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <input value={f.tiempo} onChange={(e) => setInts((c) => c.map((x, j) => j === i ? { ...x, tiempo: e.target.value } : x))}
                      placeholder="0:30" disabled={guardando}
                      className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                    <input value={f.pregunta} onChange={(e) => setInts((c) => c.map((x, j) => j === i ? { ...x, pregunta: e.target.value } : x))}
                      placeholder={t('academyV.questionPlaceholder')} disabled={guardando}
                      className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                    <button onClick={() => setInts((c) => c.filter((_, j) => j !== i))} disabled={guardando}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><Trash2 className="h-4 w-4" /></button>
                  </div>

                  <textarea value={f.opciones} onChange={(e) => setInts((c) => c.map((x, j) => j === i ? { ...x, opciones: e.target.value } : x))}
                    placeholder={t('academyV.optionsPlaceholder')} rows={3} disabled={guardando}
                    className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground" />

                  {/* Elegir el destino por NOMBRE: pedir un uuid a mano es la
                      parte que hacia esto inservible sin el diagrama. */}
                  {otrosVideos.length > 0 && (
                    <select value="" disabled={guardando}
                      onChange={(e) => { agregarDestino(i, e.target.value); e.target.value = '' }}
                      className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                      <option value="">{t('academyE.addBranch')}</option>
                      {otrosVideos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                    </select>
                  )}

                  <label className="flex items-start gap-2 text-xs text-foreground">
                    <input type="checkbox" checked={f.rama} disabled={guardando}
                      onChange={(e) => setInts((c) => c.map((x, j) => j === i ? { ...x, rama: e.target.checked } : x))}
                      className="mt-0.5 h-4 w-4 rounded border-border" />
                    <span className="flex items-center gap-1.5">
                      {f.rama ? <GitBranch className="h-3.5 w-3.5 text-sky-500" /> : <HelpCircle className="h-3.5 w-3.5 text-amber-500" />}
                      {t('academyV.branchMode')}
                    </span>
                  </label>

                  {!f.rama && (
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {t('academyV.correctLabel')}
                        <input value={f.correcta} onChange={(e) => setInts((c) => c.map((x, j) => j === i ? { ...x, correcta: e.target.value } : x))}
                          disabled={guardando}
                          className="w-12 rounded-lg border border-border bg-background px-2 py-1 text-center text-sm text-foreground" />
                      </label>
                      <input value={f.explicacion} onChange={(e) => setInts((c) => c.map((x, j) => j === i ? { ...x, explicacion: e.target.value } : x))}
                        placeholder={t('academyV.explanationPlaceholder')} disabled={guardando}
                        className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* CERTIFICACION */}
          <div className="space-y-2 rounded-lg border border-border p-3">
            <span className="block text-sm font-medium text-foreground">{t('academyV.certification')}</span>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" checked={exigeAcuse} onChange={(e) => setExigeAcuse(e.target.checked)} disabled={guardando}
                className="mt-0.5 h-4 w-4 rounded border-border" />
              <span>{t('academyV.requiresAck')}</span>
            </label>
            {exigeAcuse && (
              <textarea value={textoAcuse} onChange={(e) => setTextoAcuse(e.target.value)} rows={2} disabled={guardando}
                placeholder={t('academyE.ackTextPlaceholder')}
                className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
            )}
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" checked={exigeFirma} onChange={(e) => setExigeFirma(e.target.checked)} disabled={guardando}
                className="mt-0.5 h-4 w-4 rounded border-border" />
              <span>{t('academyV.requiresVerification')}</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <span>{t('academyV.validMonths')}</span>
              <input value={meses} onChange={(e) => setMeses(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="12" disabled={guardando}
                className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-center text-sm text-foreground" />
              <span className="text-xs text-muted-foreground">{t('academyV.validMonthsHint')}</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} disabled={guardando}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40">
              {t('academyV.cancel')}
            </button>
            <button onClick={guardar} disabled={guardando || !titulo.trim()}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t('academyV.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
