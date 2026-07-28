/**
 * Vista de un modulo: lecciones (bloques) + quiz. Access-gated.
 * El quiz es cliente: al aprobar (>=70%) guarda el progreso via API.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { COURSE_BY_ID } from '@/lib/academy/courses'
import { canAccessCourse, getCourseProgress } from '@/lib/academy/data'
import { AcademyIcon } from '@/lib/academy/icons'
import { ArrowLeft } from 'lucide-react'
import { BlockRenderer } from '../../BlockRenderer'
import { ModuleQuiz } from './ModuleQuiz'
import { getServerT } from '@/lib/i18n/server'

interface PageProps {
  params: { workspaceSlug: string; courseId: string; moduleId: string }
}

export default async function ModulePage({ params }: PageProps) {
  const course = COURSE_BY_ID[params.courseId]
  if (!course) notFound()
  const mod = course.modules.find((m) => m.id === params.moduleId)
  if (!mod) notFound()

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
  if (!(await canAccessCourse(user.id, course.id))) redirect(base)

  const progress = await getCourseProgress(user.id, course.id)
  const modIndex = course.modules.findIndex((m) => m.id === mod.id)
  const nextMod = course.modules[modIndex + 1] ?? null
  const t = getServerT()

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Link
        href={`${base}/${course.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {course.title}
      </Link>

      <div className="mb-6 flex items-center gap-4">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${course.accent}22`, color: course.accent }}
        >
          <AcademyIcon name={mod.icon} className="h-6 w-6" />
        </span>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('academyC.moduleLabel')} {mod.num} · {mod.dur}
          </p>
          <h1 className="text-xl font-bold text-foreground">{mod.title}</h1>
        </div>
      </div>

      {mod.tag && (
        <p className="mb-6 rounded-lg border-l-4 border-primary bg-primary/5 p-3 text-sm italic text-foreground">
          {mod.tag}
        </p>
      )}

      {mod.objectives && mod.objectives.length > 0 && (
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">{t('academyC.objectives')}</h2>
          <ul className="space-y-1.5">
            {mod.objectives.map((o, i) => (
              <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-8">
        {mod.lessons.map((lesson, i) => (
          <section key={i}>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: course.accent }}
              >
                {i + 1}
              </span>
              {lesson.t}
            </h2>
            <BlockRenderer blocks={lesson.blocks} />
          </section>
        ))}
      </div>

      <ModuleQuiz
        courseId={course.id}
        moduleId={mod.id}
        quiz={mod.quiz}
        accent={course.accent}
        alreadyPassed={Boolean(progress[mod.id]?.completed)}
        nextHref={nextMod ? `${base}/${course.id}/${nextMod.id}` : `${base}/${course.id}`}
        nextLabel={nextMod ? t('academyC.nextModule') : t('academyC.backToCourse')}
      />
    </div>
  )
}
