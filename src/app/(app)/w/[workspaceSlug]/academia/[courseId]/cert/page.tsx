/**
 * Certificado de un curso. Access-gated. Si el usuario completo todos los
 * modulos y aun no tiene certificado, puede emitirlo (CertView). Si ya existe,
 * muestra el diploma imprimible.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { resolverCurso } from '@/lib/academy/catalog'
import { canAccessCourse, getCourseProgress, getCertificate } from '@/lib/academy/data'
import { CertView } from './CertView'
import { getServerT } from '@/lib/i18n/server'

interface PageProps {
  params: { workspaceSlug: string; courseId: string }
}

export default async function CertPage({ params }: PageProps) {
  const course = await resolverCurso(params.courseId)
  if (!course) notFound()

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  const [{ data: row }, { data: profile }] = await Promise.all([
    // El join workspaces!inner infiere una forma (arreglo/no nulo) distinta a la anotada.
    admin
      .from('workspace_members')
      .select('workspaces!inner ( id )')
      .eq('profile_id', user.id)
      .eq('workspaces.slug', params.workspaceSlug)
      .limit(1)
      .maybeSingle() as unknown as Promise<{ data: { workspaces: { id: string } | null } | null }>,
    admin
      .from('profiles')
      .select('display_name, email')
      .eq('id', user.id)
      .maybeSingle(),
  ])
  if (!row?.workspaces) redirect('/')

  const base = `/w/${params.workspaceSlug}/academia`
  if (!(await canAccessCourse(user.id, course.id))) redirect(base)

  const [progress, cert] = await Promise.all([
    getCourseProgress(user.id, course.id),
    getCertificate(user.id, course.id),
  ])
  const allDone = course.modules.every((m) => progress[m.id]?.completed)
  const t = getServerT()
  const recipientName = profile?.display_name || profile?.email || t('academyC.defaultStudent')

  return (
    <CertView
      courseId={course.id}
      courseTitle={course.title}
      certName={course.certName}
      accent={course.accent}
      recipientName={recipientName}
      allDone={allDone}
      backHref={`${base}/${course.id}`}
      existingCert={cert}
    />
  )
}
