'use client'

/**
 * El boton que convierte la bitacora en un REPORTE.
 *
 * El problema que resuelve no es de datos, es de fricción. La bitacora ya tenia
 * todo lo que paso en la semana, pero repartido en treinta renglones sueltos.
 * Nadie los junta: el viernes se escribe "avancé en varias cosas" y la semana
 * entera se pierde. Aqui se arma el texto que si se puede pegar en un correo.
 *
 * Tres decisiones que no son cosmeticas:
 *
 * 1. ABRIR NO CUESTA NADA. Al abrir solo se hace GET, que lee el guardado. La
 *    llamada al modelo pasa unicamente cuando alguien aprieta "Armar". Si la
 *    pantalla generara sola, cada visita seria dinero y el texto cambiaria de
 *    redaccion cada vez.
 * 2. REARMAR SE PIDE, NO SE SUPONE. Un reporte que se redacta distinto cada vez
 *    que se abre no es un reporte, es una opinion. Si alguien lo citó el lunes,
 *    tiene que decir lo mismo el martes.
 * 3. EL ALCANCE LO DECIDE EL SERVIDOR. El selector "equipo" solo se pinta si
 *    quien mira es mando, pero eso es cortesia visual: el candado de verdad
 *    esta en /api/daily-reports/digest, porque todas las rutas /api usan el
 *    service role y se saltan RLS.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FileText, X, Copy, RefreshCw, Sparkles, Users, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/kern/Markdown'
import { useI18n } from '@/lib/i18n/LanguageProvider'

type Period = 'dia' | 'semana' | 'rango'
type Alcance = 'mio' | 'equipo'

interface Props {
  workspaceId: string
  from: string
  to: string
  period: Period
  /** Solo un mando puede pedir el del equipo. */
  isSupervisor: boolean
  /** Texto del boton. Si falta, se usa el generico. */
  label?: string
  className?: string
}

interface Estado {
  content: string | null
  updatedAt: string | null
  /** El periodo no tenia ni una actividad registrada. No es error. */
  vacio: boolean
}

const VACIO: Estado = { content: null, updatedAt: null, vacio: false }

export function DigestButton({
  workspaceId,
  from,
  to,
  period,
  isSupervisor,
  label,
  className,
}: Props) {
  const { t: tr, lang } = useI18n()
  const [abierto, setAbierto] = useState(false)
  const [alcance, setAlcance] = useState<Alcance>('mio')
  const [estado, setEstado] = useState<Estado>(VACIO)
  const [cargando, setCargando] = useState(false)
  const [armando, setArmando] = useState(false)

  /** `null` = el mio; `'equipo'` = todos. Es lo que entiende la ruta. */
  const profileParam = alcance === 'equipo' ? 'equipo' : undefined

  // Al abrir (y al cambiar de alcance) se lee lo guardado. Solo lectura: esto
  // nunca dispara al modelo.
  const cargarGuardado = useCallback(async () => {
    setCargando(true)
    setEstado(VACIO)
    try {
      const sp = new URLSearchParams({ workspace_id: workspaceId, from, to, period })
      if (profileParam) sp.set('profile_id', profileParam)
      const res = await fetch(`/api/daily-reports/digest?${sp.toString()}`)
      if (!res.ok) {
        setEstado(VACIO)
        return
      }
      const json = (await res.json()) as { content: string | null; updated_at: string | null }
      setEstado({ content: json.content, updatedAt: json.updated_at, vacio: false })
    } catch {
      setEstado(VACIO)
    } finally {
      setCargando(false)
    }
  }, [from, period, profileParam, to, workspaceId])

  useEffect(() => {
    if (abierto) void cargarGuardado()
  }, [abierto, cargarGuardado])

  const armar = useCallback(
    async (force: boolean) => {
      setArmando(true)
      try {
        const res = await fetch('/api/daily-reports/digest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            from,
            to,
            period,
            profile_id: profileParam ?? undefined,
            force,
          }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          content?: string | null
          updated_at?: string | null
          empty?: boolean
          saved?: boolean
          error?: string
        }
        if (!res.ok) {
          toast.error(json.error ?? tr('digest.errorArmar'))
          return
        }
        if (json.empty) {
          setEstado({ content: null, updatedAt: null, vacio: true })
          return
        }
        setEstado({ content: json.content ?? null, updatedAt: json.updated_at ?? null, vacio: false })
        // Que no se pueda GUARDAR no es razon para tirar el texto, pero si para
        // avisar: quien lo necesite tiene que copiarlo ahora.
        if (json.saved === false) toast.warning(tr('digest.noGuardado'))
      } catch {
        toast.error(tr('digest.errorRed'))
      } finally {
        setArmando(false)
      }
    },
    [from, period, profileParam, to, tr, workspaceId]
  )

  const copiar = useCallback(async () => {
    if (!estado.content) return
    try {
      await navigator.clipboard.writeText(estado.content)
      toast.success(tr('digest.copiado'))
    } catch {
      toast.error(tr('digest.errorCopiar'))
    }
  }, [estado.content, tr])

  const ocupado = cargando || armando

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent',
          className
        )}
        title={tr('digest.tooltip')}
      >
        <FileText className="h-3.5 w-3.5" />
        {label ?? tr('digest.boton')}
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
          onClick={() => setAbierto(false)}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-border bg-[#0F0F10] px-4 py-3 text-white">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FED500] text-[#0F0F10]">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-semibold">{tr('digest.titulo')}</p>
                  <p className="text-[11px] text-white/50">
                    {period === 'dia' ? from : `${from} / ${to}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAbierto(false)}
                className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                aria-label={tr('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {/* El selector de alcance solo existe para mandos. Para el resto no
                hay decision que tomar: su reporte es el suyo. */}
            {isSupervisor && (
              <div className="flex items-center gap-1 border-b border-border px-4 py-2">
                {(['mio', 'equipo'] as Alcance[]).map(a => (
                  <button
                    key={a}
                    onClick={() => setAlcance(a)}
                    disabled={ocupado}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                      alcance === a
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    {a === 'mio' ? <User className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                    {a === 'mio' ? tr('digest.alcanceMio') : tr('digest.alcanceEquipo')}
                  </button>
                ))}
              </div>
            )}

            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
              {cargando ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{tr('digest.cargando')}</p>
              ) : armando ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <Sparkles className="h-5 w-5 animate-pulse text-[#FED500]" />
                  <p className="text-sm text-muted-foreground">{tr('digest.armando')}</p>
                </div>
              ) : estado.vacio ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{tr('digest.sinMaterial')}</p>
              ) : estado.content ? (
                <div className="text-[13px] leading-relaxed text-foreground">
                  <Markdown text={estado.content} />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="max-w-sm text-sm text-muted-foreground">{tr('digest.aunNoArmado')}</p>
                  <button
                    onClick={() => void armar(false)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F0F10] px-3.5 py-2 text-xs font-medium text-[#FED500] transition-opacity hover:opacity-90"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {tr('digest.armar')}
                  </button>
                </div>
              )}
            </div>

            {estado.content && !ocupado && (
              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
                <span className="text-[11px] text-muted-foreground">
                  {estado.updatedAt
                    ? tr('digest.armadoEl').replace(
                        '{fecha}',
                        new Date(estado.updatedAt).toLocaleString(lang === 'en' ? 'en-US' : 'es-MX', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      )
                    : ''}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void armar(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={tr('digest.rearmarTooltip')}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {tr('digest.rearmar')}
                  </button>
                  <button
                    onClick={() => void copiar()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F0F10] px-3 py-1.5 text-xs font-medium text-[#FED500] transition-opacity hover:opacity-90"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {tr('digest.copiar')}
                  </button>
                </div>
              </footer>
            )}
          </div>
        </div>
      )}
    </>
  )
}
