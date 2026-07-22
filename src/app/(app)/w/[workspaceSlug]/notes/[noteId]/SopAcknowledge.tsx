'use client'

/**
 * Acuse de lectura de un SOP / documento operativo ("Leído y entendido").
 * Solo se muestra para notas que son documento (doc_kind !== 'note').
 *
 * Circuito:
 *  - GET  /api/notes/[id]/ack  -> estado (mi acuse + lista + versión vigente)
 *  - POST /api/notes/[id]/ack  -> marco "Leído y entendido" (sella sop_version)
 *  - DELETE                    -> retiro mi acuse
 *
 * "Desactualizado": si el SOP publicó una versión nueva después de que el
 * usuario acusó, su acuse queda obsoleto y se le pide re-acusar.
 */
import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { CheckCircle2, Circle, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react'
import { getInitials, timeAgo } from '@/lib/utils'

interface AckEntry {
  profile_id: string
  display_name: string
  avatar_url: string | null
  acknowledged_at: string
  sop_version: string | null
  outdated: boolean
}

interface AckState {
  current_version: string | null
  count: number
  acknowledged_by_me: boolean
  my_ack: AckEntry | null
  acks: AckEntry[]
}

interface SopAcknowledgeProps {
  noteId: string
}

export function SopAcknowledge({ noteId }: SopAcknowledgeProps) {
  const [state, setState] = useState<AckState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showList, setShowList] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notes/${noteId}/ack`)
      if (res.ok) setState(await res.json())
    } catch {
      // secundario: no romper la nota
    } finally {
      setLoading(false)
    }
  }, [noteId])

  useEffect(() => { load() }, [load])

  const acknowledge = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/notes/${noteId}/ack`, { method: 'POST' })
      if (!res.ok) throw new Error()
      toast.success('Registrado: leído y entendido')
      await load()
    } catch {
      toast.error('No se pudo registrar el acuse')
    } finally {
      setBusy(false)
    }
  }, [noteId, load])

  const retract = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/notes/${noteId}/ack`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Acuse retirado')
      await load()
    } catch {
      toast.error('No se pudo retirar el acuse')
    } finally {
      setBusy(false)
    }
  }, [noteId, load])

  if (loading || !state) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Cargando acuse de lectura…
      </div>
    )
  }

  const mine = state.my_ack
  const outdated = !!mine && mine.outdated
  const confirmed = state.acknowledged_by_me

  return (
    <section className="mt-8 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Acuse de lectura</p>
          <p className="text-xs text-muted-foreground">
            {confirmed
              ? `Confirmaste haber leído y entendido este documento${mine?.sop_version ? ` (v${mine.sop_version})` : ''}.`
              : outdated
                ? 'Se publicó una versión nueva. Vuelve a confirmar la lectura.'
                : 'Confirma que leíste y entendiste este documento.'}
          </p>
        </div>

        {confirmed ? (
          <button
            onClick={retract}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Confirmado · retirar
          </button>
        ) : (
          <button
            onClick={acknowledge}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Circle className="w-3.5 h-3.5" />}
            {outdated ? 'Re-confirmar lectura' : 'Leído y entendido'}
          </button>
        )}
      </div>

      {outdated && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600">
          <AlertTriangle className="w-3 h-3" />
          Tu acuse previo era de la v{mine?.sop_version ?? '-'}; la versión vigente es la v{state.current_version ?? '-'}.
        </p>
      )}

      {state.count > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <button
            onClick={() => setShowList(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {state.count} {state.count === 1 ? 'persona ha confirmado' : 'personas han confirmado'} · {showList ? 'ocultar' : 'ver'}
          </button>

          {showList && (
            <ul className="mt-2 space-y-1.5">
              {state.acks.map(a => (
                <li key={a.profile_id} className="flex items-center gap-2 text-xs">
                  <div className="w-5 h-5 rounded-full overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center text-[9px] font-medium">
                    {a.avatar_url ? (
                      <Image src={a.avatar_url} alt={a.display_name} width={20} height={20} className="object-cover" />
                    ) : getInitials(a.display_name)}
                  </div>
                  <span className="text-foreground truncate">{a.display_name}</span>
                  <span className="text-muted-foreground">{timeAgo(a.acknowledged_at)}</span>
                  {a.outdated && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 ml-auto flex-shrink-0">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      desactualizado
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
