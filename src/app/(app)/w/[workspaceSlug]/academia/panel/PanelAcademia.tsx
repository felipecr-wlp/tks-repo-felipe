'use client'

/**
 * Panel de configuracion de la Academia. Cuatro pestañas: Escuelas, Stacks,
 * Rutas y Videos.
 *
 * Todo se guarda con PATCH al salir del campo (onBlur), no con un boton
 * "Guardar" al final: un panel con cuarenta campos y un solo boton es un
 * panel donde alguien edita diez cosas, se va, y las pierde todas.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  GraduationCap, Layers, Route as RouteIcon, Clapperboard,
  Plus, Trash2, ExternalLink, AlertTriangle, Stethoscope, CheckCircle2, Info, Workflow,
} from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'
import type {
  EscuelaAcademia, RutaAcademia, StackAcademia, VideoAcademia,
} from '@/lib/academy/videos'
import { diagnosticar } from '@/lib/academy/diagnostico'
import { SelectorPersonas } from './SelectorPersonas'

interface Props {
  workspaceSlug: string
  escuelas: EscuelaAcademia[]
  stacks: StackAcademia[]
  rutas: RutaAcademia[]
  videos: VideoAcademia[]
  /** Personas nombradas por video, para avisar del 'personas sin nadie'. */
  nombradasPorVideo: Record<string, number>
}

type Pestana = 'escuelas' | 'stacks' | 'rutas' | 'videos' | 'pruebas'

export function PanelAcademia({
  workspaceSlug, escuelas, stacks, rutas, videos, nombradasPorVideo,
}: Props) {
  const t = useT()
  const router = useRouter()
  const [pestana, setPestana] = useState<Pestana>('escuelas')
  const [ocupado, setOcupado] = useState(false)
  // Video cuyo selector de personas esta abierto.
  const [eligiendo, setEligiendo] = useState<{ id: string; titulo: string } | null>(null)

  async function llamar(url: string, metodo: string, cuerpo?: unknown) {
    setOcupado(true)
    try {
      const res = await fetch(url, {
        method: metodo,
        headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Error')
      router.refresh()
      return json
    } catch (e) {
      // El mensaje del server se enseña tal cual: el server sabe POR QUE
      // fallo (ruta sin entrada, destino inexistente) y una frase generica
      // manda a adivinar.
      toast.error(e instanceof Error ? e.message : t('academyV.genericError'))
      return null
    } finally {
      setOcupado(false)
    }
  }

  // Diagnostico en memoria: usa los metadatos que la pagina ya cargo, asi que
  // abrirlo cien veces no descarga un solo byte de video (cero egress).
  const hallazgos = useMemo(
    () => diagnosticar(videos, rutas, nombradasPorVideo),
    [videos, rutas, nombradasPorVideo],
  )
  const errores = hallazgos.filter((h) => h.gravedad === 'error').length

  const TABS: Array<{ id: Pestana; icono: typeof Layers; texto: string; n: number }> = [
    { id: 'escuelas', icono: GraduationCap, texto: t('academyP.schools'), n: escuelas.length },
    { id: 'stacks', icono: Layers, texto: t('academyP.stacks'), n: stacks.length },
    { id: 'rutas', icono: RouteIcon, texto: t('academyR.routes'), n: rutas.length },
    { id: 'videos', icono: Clapperboard, texto: t('academyP.videos'), n: videos.length },
    { id: 'pruebas', icono: Stethoscope, texto: t('academyP.tests'), n: hallazgos.length },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('academyP.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('academyP.subtitle')}</p>
        </div>
        <Link
          href={`/w/${workspaceSlug}/academia/panel/diagrama`}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Workflow className="h-4 w-4" /> {t('academyD.diagram')}
        </Link>
      </div>

      {/* Pestañas con scroll horizontal: en telefono cuatro no caben. */}
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border pb-px">
        {TABS.map((x) => (
          <button
            key={x.id}
            onClick={() => setPestana(x.id)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              pestana === x.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <x.icono className="h-4 w-4" /> {x.texto}
            <span className="rounded-full bg-muted px-1.5 text-[11px]">{x.n}</span>
          </button>
        ))}
      </div>

      {pestana === 'escuelas' && (
        <div className="space-y-2">
          {escuelas.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              <span
                className="shrink-0 rounded px-2 py-0.5 font-mono text-xs font-bold text-white"
                style={{ backgroundColor: e.accent }}
              >
                {e.code}
              </span>
              <input
                defaultValue={e.title}
                disabled={ocupado}
                onBlur={(ev) => {
                  const v = ev.target.value.trim()
                  if (v && v !== e.title) llamar(`/api/academy/schools/${e.id}`, 'PATCH', { title: v })
                }}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-foreground hover:border-border focus:border-primary focus:outline-none"
              />
              {e.mandatory && (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                  {t('academyV.mandatory')}
                </span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">
                {stacks.filter((s) => s.school_id === e.id).length} stacks
              </span>
            </div>
          ))}
        </div>
      )}

      {pestana === 'stacks' && (
        <div className="space-y-2">
          <BotonCrear
            texto={t('academyV.newStack')}
            ocupado={ocupado}
            onCrear={(title) => llamar('/api/academy/stacks', 'POST', { title })}
            prompt={t('academyV.newStackPrompt')}
          />
          {stacks.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
              <input
                defaultValue={s.title}
                disabled={ocupado}
                onBlur={(ev) => {
                  const v = ev.target.value.trim()
                  if (v && v !== s.title) llamar(`/api/academy/stacks/${s.id}`, 'PATCH', { title: v })
                }}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-foreground hover:border-border focus:border-primary focus:outline-none"
              />
              <select
                defaultValue={s.school_id ?? ''}
                disabled={ocupado}
                onChange={(ev) => llamar(`/api/academy/stacks/${s.id}`, 'PATCH', { schoolId: ev.target.value || null })}
                className="shrink-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                <option value="">{t('academyV.noSchool')}</option>
                {escuelas.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.title}</option>)}
              </select>
              <span className="shrink-0 text-xs text-muted-foreground">
                {videos.filter((v) => v.stack_id === s.id).length} videos
              </span>
              <BotonBorrar ocupado={ocupado} onBorrar={() => llamar(`/api/academy/stacks/${s.id}`, 'DELETE')} />
            </div>
          ))}
        </div>
      )}

      {pestana === 'rutas' && (
        <div className="space-y-2">
          <BotonCrear
            texto={t('academyR.newRoute')}
            ocupado={ocupado}
            onCrear={(title) => llamar('/api/academy/paths', 'POST', { title })}
            prompt={t('academyR.namePrompt')}
          />
          {rutas.map((r) => (
            <div key={r.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  defaultValue={r.title}
                  disabled={ocupado}
                  onBlur={(ev) => {
                    const v = ev.target.value.trim()
                    if (v && v !== r.title) llamar(`/api/academy/paths/${r.id}`, 'PATCH', { title: v })
                  }}
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-foreground hover:border-border focus:border-primary focus:outline-none"
                />
                <Link
                  href={`/w/${workspaceSlug}/academia/rutas/${r.id}`}
                  className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted"
                  aria-label={t('academyP.open')}
                >
                  <ExternalLink className="h-4 w-4" />
                </Link>
                <BotonBorrar ocupado={ocupado} onBorrar={() => llamar(`/api/academy/paths/${r.id}`, 'DELETE')} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted-foreground">{t('academyP.entryVideo')}</label>
                <select
                  defaultValue={r.entry_video_id ?? ''}
                  disabled={ocupado}
                  onChange={(ev) => llamar(`/api/academy/paths/${r.id}`, 'PATCH', { entryVideoId: ev.target.value || null })}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
                >
                  <option value="">{t('academyP.noEntry')}</option>
                  {videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                </select>
                <select
                  defaultValue={r.school_id ?? ''}
                  disabled={ocupado}
                  onChange={(ev) => llamar(`/api/academy/paths/${r.id}`, 'PATCH', { schoolId: ev.target.value || null })}
                  className="shrink-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
                >
                  <option value="">{t('academyV.noSchool')}</option>
                  {escuelas.map((e) => <option key={e.id} value={e.id}>{e.code}</option>)}
                </select>
                <select
                  defaultValue={r.status}
                  disabled={ocupado}
                  onChange={(ev) => llamar(`/api/academy/paths/${r.id}`, 'PATCH', { status: ev.target.value })}
                  className="shrink-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
                >
                  <option value="draft">{t('academyV.draft')}</option>
                  <option value="live">{t('academyP.published')}</option>
                </select>
              </div>
              {!r.entry_video_id && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {t('academyR.noEntry')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {pestana === 'videos' && (
        <div className="space-y-2">
          <p className="mb-3 text-xs text-muted-foreground">{t('academyP.videosHint')}</p>
          {videos.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{v.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {v.interactions.length} {t('academyP.questions')}
                  {v.interactions.some((i) => i.opts.some((o) => o.go)) && ` · ${t('academyV.branching')}`}
                </p>
              </div>
              <select
                defaultValue={v.stack_id ?? ''}
                disabled={ocupado}
                onChange={(ev) => llamar(`/api/academy/videos/${v.id}`, 'PATCH', { stackId: ev.target.value || null })}
                className="shrink-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                <option value="">{t('academyV.noStack')}</option>
                {stacks.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <select
                defaultValue={v.status}
                disabled={ocupado}
                onChange={(ev) => llamar(`/api/academy/videos/${v.id}`, 'PATCH', { status: ev.target.value })}
                className="shrink-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                <option value="draft">{t('academyV.draft')}</option>
                <option value="live">{t('academyP.published')}</option>
              </select>
              <select
                value={v.audience}
                disabled={ocupado}
                onChange={(ev) => {
                  const modo = ev.target.value
                  if (modo === 'personas') {
                    // Se guarda el modo Y se abre el selector en el mismo
                    // gesto: elegir "por personas" sin nombrar a nadie deja el
                    // video invisible, y pedirlo despues es pedir que alguien
                    // se acuerde.
                    llamar(`/api/academy/videos/${v.id}`, 'PATCH', { audience: 'personas' })
                      .then(() => setEligiendo({ id: v.id, titulo: v.title }))
                    return
                  }
                  if (modo !== 'perfiles') {
                    llamar(`/api/academy/videos/${v.id}`, 'PATCH', { audience: modo })
                    return
                  }
                  // Elegir "por perfiles" sin decir cuales no lo ve NADIE, asi
                  // que se preguntan en el mismo gesto en vez de dejar el
                  // video invisible sin avisar.
                  const txt = window.prompt(t('academyP.profilesPrompt'), v.audience_profiles.join(', '))
                  if (txt === null) return
                  llamar(`/api/academy/videos/${v.id}`, 'PATCH', {
                    audience: 'perfiles',
                    audienceProfiles: txt.split(',').map((x) => x.trim()).filter(Boolean),
                  })
                }}
                className="shrink-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
                title={t('academyP.audience')}
              >
                <option value="todos">{t('academyP.audAll')}</option>
                <option value="perfiles">{t('academyP.audProfiles')}</option>
                <option value="personas">{t('academyP.audPeople')}</option>
              </select>
              {v.audience === 'personas' && (
                <button
                  onClick={() => setEligiendo({ id: v.id, titulo: v.title })}
                  disabled={ocupado}
                  className="shrink-0 rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                >
                  {t('academyP.whoSees')}
                </button>
              )}
              {/* El id se puede copiar: es lo que se pega al escribir una rama. */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(v.id)
                  toast.success(t('academyP.idCopied'))
                }}
                className="shrink-0 rounded border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-muted"
              >
                {t('academyP.copyId')}
              </button>
              <Link
                href={`/w/${workspaceSlug}/academia/videos/${v.id}`}
                className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted"
                aria-label={t('academyP.open')}
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            </div>
          ))}
        </div>
      )}
      {pestana === 'pruebas' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-sm font-medium text-foreground">{t('academyP.testsTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('academyP.testsHint')}</p>
          </div>

          {hallazgos.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5 shrink-0" /> {t('academyP.allGood')}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {errores} {t('academyP.errors')} · {hallazgos.length - errores} {t('academyP.warnings')}
              </p>
              {hallazgos.map((h, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-3 ${
                    h.gravedad === 'error'
                      ? 'border-red-500/40 bg-red-500/5'
                      : 'border-amber-500/40 bg-amber-500/5'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {h.gravedad === 'error'
                      ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                      : <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{h.titulo}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{h.arreglo}</p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {t('academyP.in')}: <strong>{h.donde}</strong>
                      </p>
                    </div>
                    {(h.videoId || h.pathId) && (
                      <Link
                        href={h.videoId
                          ? `/w/${workspaceSlug}/academia/videos/${h.videoId}`
                          : `/w/${workspaceSlug}/academia/rutas/${h.pathId}`}
                        className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted"
                        aria-label={t('academyP.open')}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {eligiendo && (
        <SelectorPersonas
          videoId={eligiendo.id}
          titulo={eligiendo.titulo}
          onClose={() => setEligiendo(null)}
          onGuardado={(n) => {
            toast.success(n === 0 ? t('academyP.zeroWarning') : `${n} ${t('academyP.chosen')}`)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function BotonCrear({
  texto, prompt, ocupado, onCrear,
}: { texto: string; prompt: string; ocupado: boolean; onCrear: (t: string) => void }) {
  return (
    <button
      onClick={() => {
        const n = window.prompt(prompt)
        if (n?.trim()) onCrear(n.trim())
      }}
      disabled={ocupado}
      className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
    >
      <Plus className="h-4 w-4" /> {texto}
    </button>
  )
}

function BotonBorrar({ ocupado, onBorrar }: { ocupado: boolean; onBorrar: () => void }) {
  const t = useT()
  return (
    <button
      onClick={() => {
        // Confirmacion explicita: borrar aqui no tiene deshacer.
        if (window.confirm(t('academyP.confirmDelete'))) onBorrar()
      }}
      disabled={ocupado}
      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
      aria-label={t('academyP.delete')}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  )
}
