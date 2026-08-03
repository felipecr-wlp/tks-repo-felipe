/* Widget de Academia en el dashboard: los cursos de la persona con su progreso.
   Server component: lee el estado con getUserAcademy. Si no tiene cursos con
   acceso, invita a explorar la biblioteca.

   Para los mandos lleva ademas las SOLICITUDES SIN RESPONDER, y ese pedazo tiene
   una razon concreta. Al 2026-08-02 habia tres personas esperando acceso a un
   curso desde hacia hasta cinco dias, y no fue por falta de aviso: la
   notificacion se creo y se leyo. El problema es que una notificacion es un
   EVENTO (se lee una vez y desaparece) mientras que una solicitud pendiente es
   un ESTADO, y el unico lugar donde ese estado se veia era /settings/academia,
   que nadie abre sin motivo. Academia resulto ser la unica herramienta que la
   gente si busco sola (cinco solicitudes de cinco personas distintas en tres
   dias, dos de ellas sin ninguna otra huella en el producto). Dejarlas sin
   respuesta es la forma mas rapida de enseñarle al equipo que pedir no sirve.

   Por eso el aviso vive aqui, en la pantalla de inicio, y se queda hasta que se
   responda. Lleva la ESPERA en dias a proposito: un conteo se vuelve paisaje, un
   "5 dias esperando" no. */
import Link from 'next/link'
import { getUserAcademy, isOrgAdmin, listPendingRequests } from '@/lib/academy/data'
import { AcademyIcon } from '@/lib/academy/icons'
import { BookOpen, Award, ArrowRight, Clock } from 'lucide-react'
import { getServerT } from '@/lib/i18n/server'

/** Dias enteros que lleva esperando la solicitud mas vieja. */
function diasEsperando(desde: string): number {
  const ms = Date.now() - new Date(desde).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

export async function AcademyWidget({
  userId,
  workspaceSlug,
}: {
  userId: string
  workspaceSlug: string
}) {
  const t = getServerT()
  const states = await getUserAcademy(userId)
  const base = `/w/${workspaceSlug}/academia`

  // Solo los mandos pueden resolverlas, asi que solo a ellos se les cobra la
  // deuda. A quien no puede aprobar, enseñarle la fila seria ruido puro.
  let pendientes: Array<{ created_at: string }> = []
  if (await isOrgAdmin(userId)) {
    pendientes = await listPendingRequests()
  }
  const esperaMax = pendientes.length > 0 ? diasEsperando(pendientes[0].created_at) : 0
  const mine = states.filter((s) => s.hasAccess)
  // Priorizar en curso (no certificados, con o sin avance), luego el resto.
  const sorted = [...mine].sort((a, b) => {
    if (a.certified !== b.certified) return a.certified ? 1 : -1
    return b.progressPct - a.progressPct
  })
  const top = sorted.slice(0, 4)
  const certifiedCount = mine.filter((s) => s.certified).length

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" /> {t('academyW.title')}
        </h2>
        <Link
          href={base}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('academyW.viewAll')}
        </Link>
      </div>

      {/* La deuda va ARRIBA de los cursos propios: lo que otra persona esta
          esperando pesa mas que el avance de uno mismo. */}
      {pendientes.length > 0 && (
        <Link
          href={`/w/${workspaceSlug}/settings/academia`}
          className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 transition hover:border-amber-500/60"
        >
          <div className="flex items-center gap-2.5">
            <Clock className="h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {pendientes.length}{' '}
                {pendientes.length === 1 ? t('academyW.pendingOne') : t('academyW.pendingMany')}
              </p>
              <p className="text-xs text-muted-foreground">
                {esperaMax === 0
                  ? t('academyW.pendingToday')
                  : `${t('academyW.pendingWaitPre')} ${esperaMax} ${
                      esperaMax === 1
                        ? t('academyW.pendingWaitDayOne')
                        : t('academyW.pendingWaitDayMany')
                    }`}
              </p>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-500">
            {t('academyW.pendingCta')} <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      )}

      {mine.length === 0 ? (
        <Link
          href={base}
          className="flex items-center justify-between rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 transition hover:border-primary/50"
        >
          <div>
            <p className="text-sm font-medium text-foreground">{t('academyW.exploreTitle')}</p>
            <p className="text-xs text-muted-foreground">
              {t('academyW.exploreDesc')}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      ) : (
        <>
          {certifiedCount > 0 && (
            <p className="mb-2 flex items-center gap-1 text-xs text-emerald-500">
              <Award className="h-3.5 w-3.5" /> {certifiedCount}{' '}
              {certifiedCount === 1 ? t('academyW.certifiedOne') : t('academyW.certifiedMany')}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {top.map((s) => (
              <Link
                key={s.course.id}
                href={`${base}/${s.course.id}`}
                className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition hover:border-primary/50"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${s.course.accent}22`, color: s.course.accent }}
                >
                  <AcademyIcon name={s.course.icon} className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{s.course.title}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${s.progressPct}%`,
                          backgroundColor: s.certified ? '#10b981' : s.course.accent,
                        }}
                      />
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {s.certified ? (
                        <Award className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        `${s.progressPct}%`
                      )}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
