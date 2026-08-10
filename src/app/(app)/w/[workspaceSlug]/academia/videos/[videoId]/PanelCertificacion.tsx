'use client'

/**
 * Lo que la PERSONA ve y hace debajo del video para quedar certificada:
 * el acuse ("confirmo que lo entendi") y el estado de su certificacion.
 *
 * POR QUE VIVE JUNTO AL VIDEO Y NO EN OTRA PANTALLA. El acuse tiene sentido en
 * el momento en que se acaba de ver el contenido. Mandarlo a una bandeja
 * aparte convierte un gesto de diez segundos en una tarea que se pospone, y
 * una capacitacion firmada tres semanas despues no prueba lo mismo.
 *
 * El texto que se acepta se ENSEÑA antes de firmar. Un acuse sobre un texto
 * que la persona no leyo no vale nada delante de nadie.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import {
  ShieldCheck, Clock3, AlertTriangle, CheckCircle2, Loader2, PenLine,
} from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'
import {
  estadoCertificacion, diasHasta,
  type Certificacion, type RequisitosItem, type EstadoCertificacion,
} from '@/lib/academy/certificacion'

interface Props {
  videoId: string
  requisitos: RequisitosItem
  cert: Certificacion | null
  /** Texto a aceptar, ya resuelto en el server (el del video o el generico). */
  textoAcuse: string
  visto: boolean
  /** Instante calculado en el SERVER: el reloj del navegador se puede mover. */
  ahoraIso: string
}

const ESTILO: Record<EstadoCertificacion, { icono: typeof ShieldCheck; clase: string }> = {
  pendiente:           { icono: Clock3,        clase: 'border-border bg-muted/40 text-muted-foreground' },
  espera_verificacion: { icono: PenLine,       clase: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  vigente:             { icono: ShieldCheck,   clase: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  por_vencer:          { icono: AlertTriangle, clase: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  vencida:             { icono: AlertTriangle, clase: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300' },
}

export function PanelCertificacion({
  videoId, requisitos, cert, textoAcuse, visto, ahoraIso,
}: Props) {
  const t = useT()
  const router = useRouter()
  const [firmando, setFirmando] = useState(false)
  const [acuse, setAcuse] = useState(cert?.acknowledged_at ?? null)

  // Sin requisitos no hay nada que enseñar: un recuadro que solo dice "no
  // aplica" es ruido en la pantalla de todos los videos normales.
  if (!requisitos.requires_ack && !requisitos.requires_verification && !cert?.expires_at) {
    return null
  }

  const ahora = new Date(ahoraIso)
  const certActual = acuse && cert ? { ...cert, acknowledged_at: acuse }
    : acuse ? ({
        profile_id: '', item_type: 'video' as const, item_id: videoId,
        acknowledged_at: acuse, verified_at: null, verified_by: null, expires_at: null,
      })
    : cert
  const estado = estadoCertificacion(certActual, requisitos, visto, ahora)
  const { icono: Icono, clase } = ESTILO[estado]

  async function firmarAcuse() {
    if (firmando) return
    setFirmando(true)
    try {
      const res = await fetch('/api/academy/certifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType: 'video', itemId: videoId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')
      setAcuse(json.acknowledgedAt)
      toast.success(t('academyC.ackDone'))
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('academyV.genericError'))
    } finally {
      setFirmando(false)
    }
  }

  const faltanDias = certActual?.expires_at ? diasHasta(certActual.expires_at, ahora) : null

  return (
    <div className={`mt-5 rounded-xl border p-4 ${clase}`}>
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Icono className="h-4 w-4 shrink-0" /> {t(`academyC.estado.${estado}`)}
      </p>

      {faltanDias !== null && (
        <p className="mt-1 text-xs">
          {faltanDias < 0
            ? `${t('academyC.expiredAgo')} ${Math.abs(faltanDias)} ${t('academyC.days')}`
            : `${t('academyC.expiresIn')} ${faltanDias} ${t('academyC.days')}`}
        </p>
      )}

      {/* El acuse: se enseña el texto ANTES de firmarlo. */}
      {requisitos.requires_ack && !acuse && visto && (
        <div className="mt-3 rounded-lg border border-border bg-background p-3">
          <p className="text-sm text-foreground">{textoAcuse}</p>
          <button
            onClick={firmarAcuse}
            disabled={firmando}
            className="mt-3 flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {firmando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t('academyC.ackButton')}
          </button>
        </div>
      )}

      {requisitos.requires_ack && !visto && (
        <p className="mt-1 text-xs">{t('academyC.watchFirst')}</p>
      )}

      {acuse && (
        <p className="mt-2 text-xs">
          {t('academyC.ackedOn')} {new Date(acuse).toLocaleDateString()}
        </p>
      )}

      {requisitos.requires_verification && estado === 'espera_verificacion' && (
        <p className="mt-2 text-xs">{t('academyC.waitingSupervisor')}</p>
      )}
    </div>
  )
}
