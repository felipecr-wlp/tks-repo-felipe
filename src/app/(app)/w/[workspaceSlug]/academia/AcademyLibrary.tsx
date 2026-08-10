'use client'

/* Biblioteca de la Academia (cliente). Rejilla de tarjetas: si hay acceso,
   enlaza al curso y muestra progreso; si no, boton "Solicitar acceso". */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AcademyIcon } from '@/lib/academy/icons'
import { CheckCircle2, Lock, Clock, ArrowRight, Award } from 'lucide-react'
import { useT } from '@/lib/i18n/LanguageProvider'
import type { CourseState } from '@/lib/academy/data'

export function AcademyLibrary({
  workspaceSlug,
  workspaceId,
  states,
  isAdmin,
}: {
  workspaceSlug: string
  workspaceId: string
  states: CourseState[]
  isAdmin: boolean
}) {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const base = `/w/${workspaceSlug}/academia`

  async function requestAccess(courseId: string) {
    setBusy(courseId)
    try {
      const res = await fetch('/api/academy/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, workspaceId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || t('academyL.requestFailed'))
      if (json.alreadyGranted) toast.success(t('academyL.alreadyGranted'))
      else toast.success(t('academyL.requestSent'))
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('academyL.genericError'))
    } finally {
      setBusy(null)
    }
  }

  const accessible = states.filter((s) => s.hasAccess)
  const locked = states.filter((s) => !s.hasAccess)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('academyL.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('academyL.subtitle')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Visible para TODOS, no solo para mandos: el permiso hace falta para
              publicar un curso, no para empezar a escribirlo. Si este enlace lo
              viera solo un admin, la feature no existiria para quien de verdad
              sabe hacer el trabajo. */}
          <Link
            href={`/w/${workspaceSlug}/academia/videos`}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            {t('academyV.title')}
          </Link>
          <Link
            href={`/w/${workspaceSlug}/academia/mis-cursos`}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            {t('academyL.myOwnCourses')}
          </Link>
          {isAdmin && (
            <Link
              href={`/w/${workspaceSlug}/settings/academia`}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              {t('academyL.manage')}
            </Link>
          )}
        </div>
      </div>

      {accessible.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {isAdmin ? t('academyL.allCourses') : t('academyL.myCourses')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {accessible.map((s) => (
              <Link
                key={s.course.id}
                href={`${base}/${s.course.id}`}
                className="group relative flex flex-col rounded-xl border border-border bg-card p-5 transition hover:border-primary/50 hover:shadow-sm"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${s.course.accent}22`, color: s.course.accent }}
                  >
                    <AcademyIcon name={s.course.icon} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {s.course.track}
                    </p>
                    <h3 className="truncate font-semibold text-foreground">{s.course.title}</h3>
                  </div>
                </div>
                <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">{s.course.subtitle}</p>
                <div className="mt-auto">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {s.completedModules}/{s.totalModules} {t('academyL.modulesSuffix')}
                    </span>
                    {s.certified ? (
                      <span className="flex items-center gap-1 font-medium text-emerald-500">
                        <Award className="h-3.5 w-3.5" /> {t('academyL.certified')}
                      </span>
                    ) : (
                      <span>{s.progressPct}%</span>
                    )}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${s.progressPct}%`,
                        backgroundColor: s.certified ? '#10b981' : s.course.accent,
                      }}
                    />
                  </div>
                  <span className="mt-3 flex items-center gap-1 text-sm font-medium text-primary opacity-0 transition group-hover:opacity-100">
                    {t('academyL.enter')} <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {locked.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('academyL.available')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {locked.map((s) => (
              <div
                key={s.course.id}
                className="flex flex-col rounded-xl border border-dashed border-border bg-card/50 p-5"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <AcademyIcon name={s.course.icon} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {s.course.track}
                    </p>
                    <h3 className="truncate font-semibold text-foreground">{s.course.title}</h3>
                  </div>
                </div>
                <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">{s.course.subtitle}</p>
                <div className="mt-auto">
                  {s.requestStatus === 'pending' ? (
                    <span className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-500">
                      <Clock className="h-4 w-4" /> {t('academyL.requestPending')}
                    </span>
                  ) : (
                    <button
                      onClick={() => requestAccess(s.course.id)}
                      disabled={busy === s.course.id}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      {busy === s.course.id
                        ? t('academyL.sending')
                        : s.requestStatus === 'rejected'
                          ? t('academyL.requestAgain')
                          : t('academyL.requestAccess')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {accessible.length === 0 && locked.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('academyL.empty')}</p>
        </div>
      )}
    </div>
  )
}
