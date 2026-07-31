'use client'

/**
 * Pintura del calendario. Todo llega resuelto del servidor: aqui no se consulta
 * nada, solo se navega y se cambia el rango.
 *
 * La rejilla se arma por SEMANAS completas empezando en lunes, no por meses.
 * Un calendario mensual obliga a que la temporalidad sea el mes; asi cualquier
 * rango (una semana, un mes, un trimestre) se pinta con la misma forma y los
 * dias sueltos del principio y del final se ven apagados, sin romper la lectura
 * de columnas por dia de la semana.
 *
 * Cada celda dice CUANTO y una muestra de QUE. No dice todo a proposito: el
 * calendario es para reconocer el periodo y encontrar el hueco, no para leerlo.
 * El detalle esta a un clic, en la vista de dia.
 */
import { useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarRange, ChevronLeft, ChevronRight, AlertTriangle, ClipboardList, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CATEGORY_LABEL, formatReportDate } from '@/lib/daily-reports'
import { DigestButton } from '../DigestButton'

export interface MiembroOpcion {
  id: string
  nombre: string
}

export interface DiaCalendario {
  date: string
  actividades: number
  bloqueosAbiertos: number
  personas: number
  muestras: { category: string; content: string; persona: string | null }[]
}

interface Props {
  workspaceId: string
  workspaceSlug: string
  from: string
  to: string
  today: string
  currentUserId: string
  isSupervisor: boolean
  /** null = se esta mirando al equipo entero. */
  profileId: string | null
  miembros: MiembroOpcion[]
  dias: DiaCalendario[]
  maxDias: number
}

/**
 * Tope del reporte armado. El calendario aguanta un trimestre, pero pedirle al
 * modelo que redacte noventa dias de un equipo es reventar el contexto. Pasado
 * este limite el boton se apaga y dice por que, en vez de fallar al apretarlo.
 */
const MAX_DIAS_DIGEST = 45

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/** Los colores repiten los de la bitácora: bloqueo rojo, lo demás calmado. */
const CAT_COLOR: Record<string, string> = {
  avance: '#3b82f6',
  bloqueo: '#ef4444',
  siguiente: '#a855f7',
  nota: '#94a3b8',
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(iso: string, n: number): string {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return toIso(d)
}

function diasEntre(from: string, to: string): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000) + 1
}

/** Lunes de la semana de `iso`. La semana laboral empieza en lunes, no en domingo. */
function lunesDe(iso: string): string {
  const d = parseIso(iso)
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return toIso(d)
}

function mesDe(iso: string): { from: string; to: string } {
  const [y, m] = iso.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(ultimo).padStart(2, '0')}` }
}

function trimestreDe(iso: string): { from: string; to: string } {
  const [y, m] = iso.split('-').map(Number)
  const inicio = Math.floor((m - 1) / 3) * 3 + 1
  const fin = inicio + 2
  const ultimo = new Date(y, fin, 0).getDate()
  return {
    from: `${y}-${String(inicio).padStart(2, '0')}-01`,
    to: `${y}-${String(fin).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`,
  }
}

function etiquetaRango(from: string, to: string): string {
  const a = parseIso(from)
  const b = parseIso(to)
  const mismoAnio = a.getFullYear() === b.getFullYear()
  const f = (d: Date, conAnio: boolean) =>
    d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', ...(conAnio ? { year: 'numeric' } : {}) })
  return `${f(a, !mismoAnio)} al ${f(b, true)}`
}

export function CalendarioClient({
  workspaceId,
  workspaceSlug,
  from,
  to,
  today,
  currentUserId,
  isSupervisor,
  profileId,
  miembros,
  dias,
  maxDias,
}: Props) {
  const router = useRouter()
  const base = `/w/${workspaceSlug}/reportes`

  const porFecha = useMemo(() => {
    const m = new Map<string, DiaCalendario>()
    for (const d of dias) m.set(d.date, d)
    return m
  }, [dias])

  const totalActividades = useMemo(() => dias.reduce((s, d) => s + d.actividades, 0), [dias])
  const totalBloqueos = useMemo(() => dias.reduce((s, d) => s + d.bloqueosAbiertos, 0), [dias])
  const diasConAlgo = dias.length

  const largoRango = diasEntre(from, to)

  // La rejilla: semanas completas desde el lunes anterior al inicio hasta cubrir
  // el final. Se calcula una vez y no en el render de cada celda.
  const semanas = useMemo(() => {
    const inicio = lunesDe(from)
    const filas: string[][] = []
    let cursor = inicio
    // El tope evita que un rango raro genere una rejilla infinita.
    for (let i = 0; i < 20; i++) {
      const fila: string[] = []
      for (let j = 0; j < 7; j++) {
        fila.push(cursor)
        cursor = addDays(cursor, 1)
      }
      filas.push(fila)
      if (fila[6] >= to) break
    }
    return filas
  }, [from, to])

  const irA = useCallback(
    (nuevoFrom: string, nuevoTo: string, p?: string | null) => {
      const sp = new URLSearchParams({ from: nuevoFrom, to: nuevoTo })
      const persona = p === undefined ? (profileId === null ? 'equipo' : profileId) : p
      if (persona) sp.set('p', persona)
      router.push(`${base}/calendario?${sp.toString()}`)
    },
    [base, profileId, router]
  )

  /** Mueve el rango completo hacia atras o adelante, conservando su largo. */
  const desplazar = useCallback(
    (signo: 1 | -1) => {
      const salto = largoRango * signo
      irA(addDays(from, salto), addDays(to, salto))
    },
    [from, irA, largoRango, to]
  )

  const presets: { clave: string; texto: string; rango: () => { from: string; to: string } }[] = [
    { clave: 'semana', texto: 'Esta semana', rango: () => ({ from: lunesDe(today), to: addDays(lunesDe(today), 6) }) },
    { clave: 'mes', texto: 'Este mes', rango: () => mesDe(today) },
    { clave: '30', texto: 'Últimos 30 días', rango: () => ({ from: addDays(today, -29), to: today }) },
    { clave: 'trimestre', texto: 'Este trimestre', rango: () => trimestreDe(today) },
  ]

  const digestBloqueado = largoRango > MAX_DIAS_DIGEST

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-3">
        <div className="flex items-start gap-2.5">
          <CalendarRange className="w-5 h-5 mt-0.5 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground leading-tight">Calendario de la bitácora</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Qué se estuvo haciendo en el periodo que elijas. Haz clic en un día para verlo completo.
            </p>
          </div>
        </div>

        {/* ── Temporalidad ────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => desplazar(-1)}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Periodo anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="px-3 py-1.5 rounded-lg border border-border bg-card">
            <span className="text-sm font-medium text-foreground">{etiquetaRango(from, to)}</span>
            <span className="ml-2 text-[11px] text-muted-foreground">{largoRango} días</span>
          </div>
          <button
            onClick={() => desplazar(1)}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Periodo siguiente"
          >
            <ChevronRight size={16} />
          </button>

          {presets.map(p => {
            const r = p.rango()
            const activo = r.from === from && r.to === to
            return (
              <button
                key={p.clave}
                onClick={() => irA(r.from, r.to)}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                  activo
                    ? 'border-transparent bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                )}
              >
                {p.texto}
              </button>
            )
          })}

          {/* Rango libre. Va al final porque es el camino largo: casi siempre lo
              que se quiere es uno de los atajos de arriba. */}
          <div className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
            <input
              type="date"
              value={from}
              max={to}
              onChange={e => e.target.value && irA(e.target.value, to)}
              className="bg-transparent text-xs text-foreground focus:outline-none"
              aria-label="Desde"
            />
            <span className="text-xs text-muted-foreground">a</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={e => e.target.value && irA(from, e.target.value)}
              className="bg-transparent text-xs text-foreground focus:outline-none"
              aria-label="Hasta"
            />
          </div>
        </div>

        {/* ── Persona (solo mandos) ───────────────────────────────────────── */}
        {isSupervisor && (
          <div className="flex flex-wrap items-center gap-2">
            <Users size={14} className="text-muted-foreground" />
            <select
              value={profileId === null ? 'equipo' : profileId}
              onChange={e => irA(from, to, e.target.value)}
              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="equipo">Todo el equipo</option>
              {miembros.map(m => (
                <option key={m.id} value={m.id}>
                  {m.id === currentUserId ? `${m.nombre} (yo)` : m.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ── Acciones y totales ──────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`${base}?d=${today}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ClipboardList size={14} />
            Ver por día
          </Link>
          {digestBloqueado ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground opacity-60"
              title={`El reporte armado cubre hasta ${MAX_DIAS_DIGEST} días. Acorta el rango para armarlo.`}
            >
              Armar reporte del periodo
            </span>
          ) : (
            <DigestButton
              workspaceId={workspaceId}
              from={from}
              to={to}
              period="rango"
              isSupervisor={isSupervisor}
              label="Armar reporte del periodo"
              className="text-sm text-muted-foreground hover:text-foreground"
            />
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {totalActividades} {totalActividades === 1 ? 'actividad' : 'actividades'} en {diasConAlgo}{' '}
            {diasConAlgo === 1 ? 'día' : 'días'}
            {totalBloqueos > 0 && ` · ${totalBloqueos} ${totalBloqueos === 1 ? 'bloqueo' : 'bloqueos'} abiertos`}
          </span>
        </div>
      </header>

      {/* ── La rejilla ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {DIAS_SEMANA.map(d => (
            <div key={d} className="px-2 py-1.5 text-center text-[11px] font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {semanas.map((fila, i) => (
          <div key={i} className="grid grid-cols-7 border-b border-border last:border-b-0">
            {fila.map(fecha => {
              const fuera = fecha < from || fecha > to
              const dia = porFecha.get(fecha)
              const esHoy = fecha === today
              const numero = parseIso(fecha).getDate()

              if (fuera) {
                return (
                  <div
                    key={fecha}
                    className="min-h-[92px] border-r border-border last:border-r-0 bg-muted/20 px-2 py-1.5"
                  >
                    <span className="text-[11px] text-muted-foreground/40">{numero}</span>
                  </div>
                )
              }

              return (
                <Link
                  key={fecha}
                  href={`${base}?d=${fecha}`}
                  title={`${formatReportDate(fecha)}${dia ? ` · ${dia.actividades} actividades` : ' · sin registro'}`}
                  className={cn(
                    'min-h-[92px] border-r border-border last:border-r-0 px-2 py-1.5 transition-colors hover:bg-accent/60',
                    esHoy && 'bg-primary/5'
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        'text-[11px]',
                        esHoy ? 'font-semibold text-primary' : 'text-muted-foreground'
                      )}
                    >
                      {numero}
                    </span>
                    <div className="flex items-center gap-1">
                      {dia && dia.bloqueosAbiertos > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium text-destructive"
                          title={`${dia.bloqueosAbiertos} bloqueos abiertos`}
                        >
                          <AlertTriangle size={10} />
                          {dia.bloqueosAbiertos}
                        </span>
                      )}
                      {dia && (
                        <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                          {dia.actividades}
                        </span>
                      )}
                    </div>
                  </div>

                  {dia && (
                    <div className="mt-1 space-y-0.5">
                      {dia.muestras.map((m, k) => (
                        <p key={k} className="flex items-start gap-1 text-[10px] leading-tight text-foreground/80">
                          <span
                            className="mt-[3px] h-1.5 w-1.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: CAT_COLOR[m.category] ?? CAT_COLOR.nota }}
                            title={CATEGORY_LABEL[m.category as keyof typeof CATEGORY_LABEL] ?? m.category}
                          />
                          <span className="line-clamp-2">
                            {m.persona && <span className="font-medium">{m.persona}: </span>}
                            {m.content}
                          </span>
                        </p>
                      ))}
                      {dia.actividades > dia.muestras.length && (
                        <p className="text-[10px] text-muted-foreground">
                          +{dia.actividades - dia.muestras.length} más
                        </p>
                      )}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </div>

      {diasConAlgo === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          No hay nada registrado en este periodo.{' '}
          <Link href={`${base}?d=${today}`} className="text-primary hover:underline">
            Ir al día de hoy
          </Link>
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        El calendario cubre hasta {maxDias} días. Cada celda muestra una parte de lo registrado; el día completo se
        abre con un clic.
      </p>
    </div>
  )
}
