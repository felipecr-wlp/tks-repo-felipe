/**
 * Vista de un curso: portada, objetivos y lista de modulos con progreso.
 * Access-gated: si el usuario no tiene acceso (ni es admin), se redirige a la
 * biblioteca. Cuando todos los modulos estan completos, aparece el CTA de
 * certificado.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { COURSE_BY_ID } from '@/lib/academy/courses'
import { canAccessCourse, getCourseProgress, getCertificate } from '@/lib/academy/data'
import { AcademyIcon } from '@/lib/academy/icons'
import { CheckCircle2, Circle, Clock, ArrowLeft, Award } from 'lucide-react'
import { getServerT } from '@/lib/i18n/server'

interface PageProps {
  params: { workspaceSlug: string; courseId: string }
}

export default async function CoursePage({ params }: PageProps) {
  const course = COURSE_BY_ID[params.courseId]
  if (!course) notFound()

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  const { data: row } = (await admin
    .from('workspace_members')
    .select('workspaces!inner ( id )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle()) as { data: { workspaces: { id: string } | null } | null }
  if (!row?.workspaces) redirect('/')

  const base = `/w/${params.workspaceSlug}/academia`

  if (!(await canAccessCourse(user.id, course.id))) {
    redirect(base)
  }

  const [progress, cert] = await Promise.all([
    getCourseProgress(user.id, course.id),
    getCertificate(user.id, course.id),
  ])

  const completedCount = course.modules.filter((m) => progress[m.id]?.completed).length
  const allDone = completedCount === course.modules.length
  const pct = Math.round((completedCount / course.modules.length) * 100)
  const t = getServerT()

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Link
        href={base}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t('academyC.backToLibrary')}
      </Link>

      <div className="mb-6 flex items-start gap-4">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${course.accent}22`, color: course.accent }}
        >
          <AcademyIcon name={course.icon} className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {course.track}
          </p>
          <h1 className="text-2xl font-bold text-foreground">{course.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{course.subtitle}</p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">
            {completedCount}/{course.modules.length} {t('academyC.modulesComplete')}
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: course.accent }}
          />
        </div>
        {(allDone || cert) && (
          <Link
            href={`${base}/${course.id}/cert`}
            className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
          >
            <Award className="h-4 w-4" />
            {cert ? t('academyC.viewCert') : t('academyC.getCert')}
          </Link>
        )}
      </div>

      <div className="space-y-2">
        {course.modules.map((m) => {
          const p = progress[m.id]
          const done = p?.completed
          return (
            <Link
              key={m.id}
              href={`${base}/${course.id}/${m.id}`}
              className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition hover:border-primary/50"
            >
              <span className="shrink-0">
                {done ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                ) : (
                  <Circle className="h-6 w-6 text-muted-foreground/50" />
                )}
              </span>
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${course.accent}18`, color: course.accent }}
              >
                <AcademyIcon name={m.icon} className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('academyC.moduleLabel')} {m.num}
                </p>
                <h3 className="truncate font-semibold text-foreground">{m.title}</h3>
              </div>
              <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                <Clock className="h-3.5 w-3.5" /> {m.dur}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
