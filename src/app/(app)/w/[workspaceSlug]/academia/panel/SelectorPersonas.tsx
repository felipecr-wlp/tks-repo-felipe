'use client'

/**
 * Elegir QUIEN ve un video cuando su audiencia es 'personas'.
 *
 * Se abre bajo demanda y carga el directorio en ese momento: el panel puede
 * listar decenas de videos y traer el padron completo por cada uno seria pagar
 * por algo que casi nunca se abre.
 *
 * Guarda la lista COMPLETA de una sola vez (PUT), no persona por persona: con
 * una peticion por casilla, un fallo a media edicion deja "marque tres, se
 * guardaron dos" sin que nadie lo note.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Search, Users, X } from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'

interface Persona { id: string; nombre: string }

interface Props {
  videoId: string
  titulo: string
  onClose: () => void
  onGuardado: (total: number) => void
}

export function SelectorPersonas({ videoId, titulo, onClose, onGuardado }: Props) {
  const t = useT()
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const res = await fetch(`/api/academy/videos/${videoId}/viewers`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Error')
        if (!vivo) return
        setPersonas(json.personas ?? [])
        setElegidos(new Set(json.nombrados ?? []))
      } catch (e) {
        if (vivo) toast.error(e instanceof Error ? e.message : t('academyV.genericError'))
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    // El flag evita escribir estado despues de cerrar el dialogo, que en React
    // 18 no revienta pero deja trabajo colgando por gusto.
    return () => { vivo = false }
  }, [videoId, t])

  async function guardar() {
    if (guardando) return
    setGuardando(true)
    try {
      const res = await fetch(`/api/academy/videos/${videoId}/viewers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileIds: Array.from(elegidos) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')
      onGuardado(elegidos.size)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('academyV.genericError'))
      setGuardando(false)
    }
  }

  const q = busqueda.trim().toLowerCase()
  const visibles = q ? personas.filter((p) => p.nombre.toLowerCase().includes(q)) : personas

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-background shadow-xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Users className="h-4 w-4" /> {t('academyP.whoSees')}
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{titulo}</p>
          </div>
          <button
            onClick={onClose}
            disabled={guardando}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label={t('academyV.cancel')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t('academyP.searchPeople')}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {cargando ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('academyP.loading')}
            </p>
          ) : visibles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('academyP.noPeople')}</p>
          ) : (
            visibles.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={elegidos.has(p.id)}
                  onChange={(e) => {
                    setElegidos((s) => {
                      const n = new Set(s)
                      if (e.target.checked) n.add(p.id)
                      else n.delete(p.id)
                      return n
                    })
                  }}
                  className="h-4 w-4 rounded border-border"
                />
                <span className="truncate text-sm text-foreground">{p.nombre}</span>
              </label>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border p-4">
          {/* Cero elegidos NO lo ve nadie: se avisa aqui, antes de guardar, en
              vez de dejar el video invisible y que se descubra semanas despues. */}
          <span className={`text-xs ${elegidos.size === 0 ? 'font-medium text-amber-600 dark:text-amber-500' : 'text-muted-foreground'}`}>
            {elegidos.size === 0 ? t('academyP.zeroWarning') : `${elegidos.size} ${t('academyP.chosen')}`}
          </span>
          <button
            onClick={guardar}
            disabled={guardando || cargando}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('academyV.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
