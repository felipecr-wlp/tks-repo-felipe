'use client'

/**
 * Pintura de la semana. Todo lo que se ve aqui llega ya resuelto del servidor:
 * este componente no consulta nada, solo navega.
 *
 * La forma es una matriz persona x dia porque la pregunta del viernes es de
 * comparacion, no de detalle: quien entrego, quien no, y donde se acumulan los
 * bloqueos. El detalle esta a un clic, en la vista de dia.
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, ClipboardList } from 'lucide-react'
import { shiftDate, formatWeekLabel, formatWeekDayShort, formatReportDate } from '@/lib/daily-reports'

export interface CeldaSemana {
  date: string
  actividades: number
  bloqueos: number
  status: 'draft' | 'submitted' | null
}

export interface FilaSemana {
  profile_id: string
  display_name: string
  avatar_url: string | null
  celdas: CeldaSemana[]
  total: number
  entregados: number
  resumenes: { date: string; summary: string }[]
}

export interface BloqueoSemana {
  date: string
  display_name: string
  content: string
}

interface Props {
  workspaceSlug: string
  dias: string[]
  today: string
  currentUserId: string
  isSupervisor: boolean
  filas: FilaSemana[]
  /** Solo los que siguen abiertos. Los cerrados se cuentan aparte. */
  bloqueos: BloqueoSemana[]
  bloqueosResueltos: number
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p.charAt(0).toUpperCase())
    .join('')
}

function Avatar({ name, url, size = 22 }: { name: string; url: string | null; size?: number }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="flex-shrink-0 flex items-center justify-center rounded-full bg-muted text-muted-foreground font-medium"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

export function SemanaClient({
  workspaceSlug,
  dias,
  today,
  currentUserId,
  isSupervisor,
  filas,
  bloqueos,
  bloqueosResueltos,
}: Props) {
  const router = useRouter()

  const base = `/w/${workspaceSlug}/reportes`
  const irASemana = (ancla: string) => router.push(`${base}/semana?d=${ancla}`)

  const enEstaSemana = dias.includes(today)
  // No se navega hacia semanas que todavia no existen.
  const haciaAdelanteBloqueado = dias[0] > today || enEstaSemana

  const totalSemana = filas.reduce((s, f) => s + f.total, 0)
  const sinReportar = filas.filter(f => f.total === 0).length

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* ── Encabezado ──────────────────────────────────────────────────── */}
      <header className="space-y-3">
        <div className="flex items-start gap-2.5">
          <CalendarDays className="w-5 h-5 mt-0.5 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground leading-tight">La semana</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isSupervisor
                ? 'Quién reportó, cuánto y qué sigue bloqueado. Haz clic en un día para verlo completo.'
                : 'Tu semana de un vistazo. Haz clic en un día para verlo completo.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => irASemana(shiftDate(dias[0], -7))}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Semana anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="px-3 py-1.5 rounded-lg border border-border bg-card">
            <span className="text-sm font-medium text-foreground">{formatWeekLabel(dias)}</span>
            {enEstaSemana && <span className="ml-2 text-[11px] font-medium text-primary">esta semana</span>}
          </div>
          <button
            onClick={() => irASemana(shiftDate(dias[0], 7))}
            disabled={haciaAdelanteBloqueado}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
            aria-label="Semana siguiente"
          >
            <ChevronRight size={16} />
          </button>
          {!enEstaSemana && (
            <button
              onClick={() => irASemana(today)}
              className="px-2.5 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Esta semana
            </button>
          )}
          <Link
            href={`${base}?d=${enEstaSemana ? today : dias[0]}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ClipboardList size={14} />
            Ver por día
          </Link>
          <span className="text-xs text-muted-foreground ml-auto">
            {totalSemana} {totalSemana === 1 ? 'actividad' : 'actividades'}
            {isSupervisor && sinReportar > 0 && ` · ${sinReportar} sin reportar`}
          </span>
        </div>
      </header>

      {/* ── Bloqueos ────────────────────────────────────────────────────── */}
      {/* Solo los que siguen abiertos. Un panel de alerta que muestra cosas ya
          resueltas se deja de abrir en dos semanas, y para entonces el que si
          importa pasa desapercibido. Los cerrados se reconocen en una linea. */}
      {bloqueos.length > 0 ? (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle size={15} className="text-amber-500" />
            {bloqueos.length === 1 ? 'Un bloqueo sigue abierto' : `${bloqueos.length} bloqueos siguen abiertos`}
            {bloqueosResueltos > 0 && (
              <span className="font-normal text-xs text-muted-foreground">
                ({bloqueosResueltos} ya {bloqueosResueltos === 1 ? 'se resolvió' : 'se resolvieron'})
              </span>
            )}
          </h2>
          <ul className="mt-3 space-y-2">
            {bloqueos.slice(0, 20).map((b, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <Link
                  href={`${base}?d=${b.date}`}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors capitalize"
                >
                  {formatWeekDayShort(b.date)}
                </Link>
                {isSupervisor && <span className="text-xs font-medium text-foreground">{b.display_name}</span>}
                <span className="text-foreground/90">{b.content}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        bloqueosResueltos > 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 size={15} className="text-emerald-500" />
            {bloqueosResueltos === 1
              ? 'Hubo un bloqueo esta semana y ya se resolvió.'
              : `Hubo ${bloqueosResueltos} bloqueos esta semana y todos se resolvieron.`}
          </p>
        )
      )}

      {/* ── Matriz persona x dia ────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                {isSupervisor ? 'Persona' : 'Yo'}
              </th>
              {dias.map(d => (
                <th
                  key={d}
                  className={`px-2 py-2.5 text-center text-xs font-medium capitalize ${
                    d === today ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {formatWeekDayShort(d)}
                </th>
              ))}
              <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.profile_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar name={f.display_name} url={f.avatar_url} />
                    <span className="truncate text-foreground">
                      {f.display_name}
                      {f.profile_id === currentUserId && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">tú</span>
                      )}
                    </span>
                  </div>
                </td>
                {f.celdas.map(c => (
                  <td key={c.date} className="px-2 py-2 text-center">
                    <CeldaDia workspaceSlug={workspaceSlug} celda={c} />
                  </td>
                ))}
                <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">{f.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Resumenes de cierre ─────────────────────────────────────────── */}
      {/* Solo se listan los dias CERRADOS con resumen. Un dia a medias no tiene
          resumen y volcarlo aqui a medio escribir daria una lectura falsa. */}
      {filas.some(f => f.resumenes.length > 0) && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Cómo se cerró cada día</h2>
          {filas
            .filter(f => f.resumenes.length > 0)
            .map(f => (
              <div key={f.profile_id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Avatar name={f.display_name} url={f.avatar_url} size={24} />
                  <span className="text-sm font-medium text-foreground">{f.display_name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {f.entregados} {f.entregados === 1 ? 'día entregado' : 'días entregados'}
                  </span>
                </div>
                <ul className="mt-3 space-y-3">
                  {f.resumenes.map(r => (
                    <li key={r.date}>
                      <Link
                        href={`/w/${workspaceSlug}/reportes?d=${r.date}`}
                        className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors capitalize"
                      >
                        {formatReportDate(r.date)}
                      </Link>
                      <p className="mt-0.5 text-sm text-foreground/90 whitespace-pre-wrap">{r.summary}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </section>
      )}

      {totalSemana === 0 && (
        <p className="text-sm text-muted-foreground">
          No hay nada registrado en esta semana.{' '}
          <Link href={`${base}?d=${today}`} className="text-primary hover:underline">
            Abrir el día de hoy
          </Link>
          .
        </p>
      )}
    </div>
  )
}

/**
 * Una celda. Tres estados que se distinguen de un vistazo y sin leer numeros:
 * vacia (no reporto), con borde (registro pero no cerro) y llena (entrego). El
 * triangulo solo aparece si ese dia hubo un bloqueo.
 */
function CeldaDia({ workspaceSlug, celda }: { workspaceSlug: string; celda: CeldaSemana }) {
  const { date, actividades, bloqueos, status } = celda

  if (actividades === 0 && !status) {
    return <span className="inline-block w-7 h-7 rounded-md border border-dashed border-border" aria-label="Sin reporte" />
  }

  const entregado = status === 'submitted'

  return (
    <Link
      href={`/w/${workspaceSlug}/reportes?d=${date}`}
      title={`${actividades} ${actividades === 1 ? 'actividad' : 'actividades'}${
        bloqueos > 0 ? `, ${bloqueos} ${bloqueos === 1 ? 'bloqueo' : 'bloqueos'}` : ''
      }${entregado ? ', entregado' : ''}`}
      className={`relative inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-medium tabular-nums transition-colors ${
        entregado
          ? 'bg-primary/15 text-foreground hover:bg-primary/25'
          : 'border border-border text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      {actividades}
      {bloqueos > 0 && (
        <AlertTriangle
          size={9}
          className="absolute -top-1 -right-1 text-amber-500 fill-amber-500/20"
          aria-label="Con bloqueo"
        />
      )}
      {entregado && bloqueos === 0 && (
        <CheckCircle2 size={9} className="absolute -top-1 -right-1 text-primary" aria-label="Entregado" />
      )}
    </Link>
  )
}
