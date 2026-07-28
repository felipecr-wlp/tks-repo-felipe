/* Widget de Academia en el dashboard: los cursos de la persona con su progreso.
   Server component: lee el estado con getUserAcademy. Si no tiene cursos con
   acceso, invita a explorar la biblioteca. */
import Link from 'next/link'
import { getUserAcademy } from '@/lib/academy/data'
import { AcademyIcon } from '@/lib/academy/icons'
import { BookOpen, Award, ArrowRight } from 'lucide-react'
import { getServerT } from '@/lib/i18n/server'

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
