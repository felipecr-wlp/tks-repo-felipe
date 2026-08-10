'use client'

/**
 * Certificaciones del equipo: firmar, ver vencimientos y saber a quien apurar.
 *
 * Se ordena por URGENCIA, no alfabeticamente: lo vencido arriba, luego lo que
 * se vence pronto, luego lo que espera firma. Una lista ordenada por nombre
 * obliga a leerla entera para encontrar lo que arde.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft, ShieldCheck, AlertTriangle, PenLine, Clock3, Loader2, Search,
} from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'
import {
  estadoCertificacion, diasHasta,
  type EstadoCertificacion,
} from '@/lib/academy/certificacion'

export interface FilaCert {
  profileId: string
  nombre: string
  itemId: string
  titulo: string
  requiereAcuse: boolean
  requiereFirma: boolean
  mesesVigencia: number | null
  acknowledgedAt: string | null
  verifiedAt: string | null
  verifiedNote: string | null
  expiresAt: string | null
  visto: boolean
}

interface Props {
  workspaceSlug: string
  filas: FilaCert[]
  miId: string
  ahoraIso: string
}

/** Orden por urgencia. Numero mas bajo = mas arriba. */
const URGENCIA: Record<EstadoCertificacion, number> = {
  vencida: 0,
  por_vencer: 1,
  espera_verificacion: 2,
  pendiente: 3,
  vigente: 4,
}

const ESTILO: Record<EstadoCertificacion, string> = {
  vencida: 'bg-red-500/10 text-red-700 dark:text-red-300',
  por_vencer: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  espera_verificacion: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  pendiente: 'bg-muted text-muted-foreground',
  vigente: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
}

export function VistaCertificaciones({ workspaceSlug, filas, miId, ahoraIso }: Props) {
  const t = useT()
  const router = useRouter()
  const [busqueda, setBusqueda] = useState('')
  const [firmando, setFirmando] = useState<string | null>(null)
  const ahora = useMemo(() => new Date(ahoraIso), [ahoraIso])

  const conEstado = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return filas
      .map((f) => ({
        ...f,
        estado: estadoCertificacion(
          {
            profile_id: f.profileId, item_type: 'video', item_id: f.itemId,
            acknowledged_at: f.acknowledgedAt, verified_at: f.verifiedAt,
            verified_by: null, expires_at: f.expiresAt,
          },
          { requires_ack: f.requiereAcuse, requires_verification: f.requiereFirma, valid_months: f.mesesVigencia },
          f.visto,
          ahora,
        ),
      }))
      .filter((f) => !q || f.nombre.toLowerCase().includes(q) || f.titulo.toLowerCase().includes(q))
      .sort((a, b) =>
        URGENCIA[a.estado] - URGENCIA[b.estado] ||
        a.nombre.localeCompare(b.nombre))
  }, [filas, busqueda, ahora])

  const cuenta = (e: EstadoCertificacion) => conEstado.filter((f) => f.estado === e).length

  async function firmar(f: FilaCert & { estado: EstadoCertificacion }) {
    const clave = `${f.profileId}:${f.itemId}`
    if (firmando) return
    // Firmarse a si mismo lo rechaza el servidor, pero avisarlo aqui evita
    // el viaje y explica POR QUE, en vez de un 422 sin contexto.
    if (f.profileId === miId) {
      toast.error(t('academyC.noSelfSign'))
      return
    }
    const nota = window.prompt(t('academyC.notePrompt'))
    if (nota === null) return
    setFirmando(clave)
    try {
      const res = await fetch('/api/academy/certifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: f.profileId, itemType: 'video', itemId: f.itemId,
          note: nota.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')
      toast.success(
        json.expiresAt
          ? `${t('academyC.signed')} ${t('academyC.validUntil')} ${new Date(json.expiresAt).toLocaleDateString()}`
          : t('academyC.signed'),
      )
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('academyV.genericError'))
    } finally {
      setFirmando(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <Link
        href={`/w/${workspaceSlug}/academia/panel`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t('academyD.back')}
      </Link>

      <h1 className="text-2xl font-bold text-foreground">{t('academyC.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('academyC.subtitle')}</p>

      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
          <AlertTriangle className="h-4 w-4" /> <strong>{cuenta('vencida')}</strong> {t('academyC.estado.vencida')}
        </span>
        <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
          <Clock3 className="h-4 w-4" /> <strong>{cuenta('por_vencer')}</strong> {t('academyC.estado.por_vencer')}
        </span>
        <span className="flex items-center gap-1.5 text-sky-700 dark:text-sky-400">
          <PenLine className="h-4 w-4" /> <strong>{cuenta('espera_verificacion')}</strong> {t('academyC.estado.espera_verificacion')}
        </span>
        <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="h-4 w-4" /> <strong>{cuenta('vigente')}</strong> {t('academyC.estado.vigente')}
        </span>
      </div>

      <div className="relative mt-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={t('academyC.search')}
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div className="mt-5 space-y-2">
        {conEstado.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('academyC.empty')}</p>
        ) : conEstado.map((f) => {
          const clave = `${f.profileId}:${f.itemId}`
          const dias = f.expiresAt ? diasHasta(f.expiresAt, ahora) : null
          return (
            <div key={clave} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{f.nombre}</p>
                <p className="truncate text-xs text-muted-foreground">{f.titulo}</p>
                {dias !== null && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {dias < 0
                      ? `${t('academyC.expiredAgo')} ${Math.abs(dias)} ${t('academyC.days')}`
                      : `${t('academyC.expiresIn')} ${dias} ${t('academyC.days')}`}
                  </p>
                )}
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ESTILO[f.estado]}`}>
                {t(`academyC.estado.${f.estado}`)}
              </span>
              {f.requiereFirma && (f.estado === 'espera_verificacion' || f.estado === 'vencida') && (
                <button
                  onClick={() => firmar(f)}
                  disabled={firmando !== null}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                >
                  {firmando === clave ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
                  {f.estado === 'vencida' ? t('academyC.recertify') : t('academyC.sign')}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
