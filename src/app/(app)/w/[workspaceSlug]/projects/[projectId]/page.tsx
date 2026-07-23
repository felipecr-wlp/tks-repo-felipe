/**
 * Gestion de proyecto (Marketplace): solo lider / manager / org admin.
 *
 * Combina en una sola superficie las tres piezas de la nueva logica:
 *   1. Charter: alcance, reglas, entregables + abrir/cerrar postulaciones.
 *   2. Postulaciones: revisar y aceptar/rechazar (al aceptar entra como miembro).
 *   3. Equipo actual: miembros del proyecto (base del CV interno).
 *
 * Server component: verifica autoridad en el handler (admin client bypass RLS).
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, MessagesSquare, LayoutDashboard } from 'lucide-react'
import { ManageProject, type Charter, type Application, type Member } from './ManageProject'
import { ProjectChat } from '@/components/chat/ProjectChat'

interface PageProps {
  params: { workspaceSlug: string; projectId: string }
}

export default async function ManageProjectPage({ params }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  type ProjRow = {
    id: string; name: string; slug: string; icon: string | null; workspace_id: string; lead_id: string | null
    scope: string | null; rules: string | null; deliverables: string | null
    open_for_applications: boolean; application_deadline: string | null; max_members: number | null
    team: { slug: string } | null
  }
  const { data: project } = await admin
    .from('projects')
    .select('id, name, slug, icon, workspace_id, lead_id, scope, rules, deliverables, open_for_applications, application_deadline, max_members, team:teams(slug)')
    .eq('id', params.projectId)
    .maybeSingle() as { data: ProjRow | null }
  if (!project) notFound()

  // Link al espacio de trabajo del proyecto (solo si ya tiene equipo + slug)
  const workspaceHref = project.team?.slug
    ? `/w/${params.workspaceSlug}/t/${project.team.slug}/p/${project.slug}`
    : null

  // Autoridad: lider / manager del proyecto / org owner-admin
  const [{ data: membership }, { data: profile }] = await Promise.all([
    admin.from('project_members').select('role').eq('project_id', project.id).eq('profile_id', user.id).maybeSingle(),
    admin.from('profiles').select('org_role').eq('id', user.id).maybeSingle(),
  ])
  const canManage = project.lead_id === user.id
    || membership?.role === 'manager'
    || profile?.org_role === 'owner' || profile?.org_role === 'admin'
  if (!canManage) redirect(`/w/${params.workspaceSlug}/projects`)

  // Postulaciones + equipo actual + historial de chat (ultimos 100).
  // Las tres consultas solo dependen de project.id y son independientes entre si.
  const [{ data: apps }, { data: members }, { data: rawChat }] = await Promise.all([
    admin
      .from('project_applications')
      .select('id, pitch, role_desired, status, created_at, applicant:profiles!project_applications_applicant_id_fkey(id, display_name, avatar_url, email)')
      .eq('project_id', project.id)
      // El join applicant:profiles infiere una forma (arreglo) distinta a Application.
      .order('created_at', { ascending: false }) as unknown as Promise<{ data: Application[] | null }>,
    // El join profile:profiles infiere una forma (arreglo) distinta a Member.
    admin
      .from('project_members')
      .select('profile_id, role, title, joined_at, profile:profiles!project_members_profile_id_fkey(id, display_name, avatar_url)')
      .eq('project_id', project.id)
      .order('joined_at', { ascending: true }) as unknown as Promise<{ data: Member[] | null }>,
    admin
      .from('project_messages')
      .select('id, author_id, body, created_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const charter: Charter = {
    id: project.id,
    name: project.name,
    icon: project.icon,
    scope: project.scope,
    rules: project.rules,
    deliverables: project.deliverables,
    open_for_applications: project.open_for_applications,
    application_deadline: project.application_deadline,
    max_members: project.max_members,
  }

  // Chat del proyecto: el historial ya se cargo arriba (rawChat); aqui solo se
  // invierte para orden cronologico. Los miembros resuelven a los autores.
  const chatMessages = (rawChat ?? []).reverse()

  const chatMembers = (members ?? [])
    .filter(m => m.profile != null)
    .map(m => ({
      id: m.profile!.id,
      display_name: m.profile!.display_name ?? 'Miembro',
      avatar_url: m.profile!.avatar_url,
    }))

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4">
        <Link href={`/w/${params.workspaceSlug}/projects`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-3.5 h-3.5" /> Oportunidades
        </Link>
        {workspaceHref && (
          <Link
            href={workspaceHref}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors"
          >
            <LayoutDashboard className="w-3.5 h-3.5" /> Ir al espacio del proyecto
          </Link>
        )}
      </div>

      <ManageProject
        charter={charter}
        applications={apps ?? []}
        members={members ?? []}
        workspaceSlug={params.workspaceSlug}
      />

      {/* Chat del proyecto (realtime) */}
      <section className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <MessagesSquare className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Chat del proyecto</h2>
        </div>
        <div className="flex flex-col h-[480px] bg-card border border-border rounded-xl overflow-hidden">
          <ProjectChat
            projectId={project.id}
            currentUserId={user.id}
            members={chatMembers}
            initialMessages={chatMessages}
          />
        </div>
      </section>
    </div>
  )
}
