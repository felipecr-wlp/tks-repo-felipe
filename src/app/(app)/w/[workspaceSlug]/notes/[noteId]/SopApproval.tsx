'use client'

/**
 * Aprobacion / firma de la version vigente de un SOP (Nivel 2, Paso 2).
 * Un documento "Activo" ahora lleva una firma responsable: quien lo aprobo y
 * cuando, sellando la version. Si se publica una version nueva, la firma queda
 * desactualizada y debe re-firmarse.
 *
 * Solo se muestra para documentos operativos (doc_kind !== 'note'). El boton de
 * firmar/revocar aparece solo para admins (lo decide `can_approve` del GET).
 *
 * Al firmar/revocar se hace router.refresh() para que la barra de metadatos
 * (estatus Activo/En revisión) refleje el cambio hecho server-side.
 */
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BadgeCheck, ShieldAlert, Loader2, PenLine, RotateCcw } from 'lucide-react'
import { useI18n } from '@/lib/i18n/LanguageProvider'

interface ApprovalState {
  approved: boolean
  outdated: boolean
  approved_by: string | null
  approver_name: string | null
  approved_at: string | null
  approved_version: string | null
  current_version: string | null
  can_approve: boolean
}

interface SopApprovalProps {
  noteId: string
}

function fmtDate(iso: string | null, locale: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export function SopApproval({ noteId }: SopApprovalProps) {
  const router = useRouter()
  const { t, lang } = useI18n()
  const locale = lang === 'en' ? 'en-US' : 'es-MX'
  const [state, setState] = useState<ApprovalState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notes/${noteId}/approve`)
      if (res.ok) setState(await res.json())
    } catch {
      // secundario: no romper la nota
    } finally {
      setLoading(false)
    }
  }, [noteId])

  useEffect(() => { load() }, [load])

  const approve = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/notes/${noteId}/approve`, { method: 'POST' })
      if (!res.ok) throw new Error()
      setState(await res.json())
      toast.success(t('sop.apprToastDone'))
      router.refresh()
    } catch {
      toast.error(t('sop.apprToastError'))
    } finally {
      setBusy(false)
    }
  }, [noteId, router, t])

  const revoke = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/notes/${noteId}/approve`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setState(await res.json())
      toast.success(t('sop.apprRevoked'))
      router.refresh()
    } catch {
      toast.error(t('sop.apprRevokeError'))
    } finally {
      setBusy(false)
    }
  }, [noteId, router, t])

  if (loading || !state) return null

  // Sin firma y sin poder firmar: no mostrar nada (evita ruido para lectores).
  if (!state.approved && !state.can_approve) return null

  const { approved, outdated, approver_name, approved_at, approved_version, current_version, can_approve } = state

  // Estilo del contenedor segun estado de la firma.
  const tone = approved && !outdated
    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
    : outdated
      ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
      : 'border-border bg-muted/30'

  return (
    <section className={`mb-6 -mt-1 ml-1 rounded-lg border px-3 py-2 ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {approved && !outdated ? (
          <BadgeCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
        ) : outdated ? (
          <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0" />
        ) : (
          <PenLine className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0 text-xs">
          {approved ? (
            <p className="text-foreground">
              <span className="font-medium">{t('sop.apprApproved')}</span> {t('sop.apprBy')} {approver_name ?? t('act.user')}
              {approved_at ? ` · ${fmtDate(approved_at, locale)}` : ''}
              {approved_version ? ` · v${approved_version}` : ''}
              {outdated && (
                <span className="text-amber-700 dark:text-amber-400">
                  {' '}· {t('sop.apprOutdatedPrefix')} v{current_version ?? '-'})
                </span>
              )}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {t('sop.apprUnapprovedPrefix')} <span className="font-medium text-foreground">{t('sop.statusActive')}</span>
              {current_version ? ` ${t('sop.apprSealsPrefix')} v${current_version}` : ''}.
            </p>
          )}
        </div>

        {can_approve && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {approved && (
              <button
                onClick={revoke}
                disabled={busy}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-border bg-background text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                {t('sop.apprRevokeBtn')}
              </button>
            )}
            <button
              onClick={approve}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-[#2563EB] text-white hover:bg-[#2563EB]/90 transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <PenLine className="w-3 h-3" />}
              {outdated ? t('sop.apprResignCurrent') : approved ? t('sop.apprResign') : t('sop.apprSignActivate')}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
