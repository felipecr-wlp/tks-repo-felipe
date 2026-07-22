/**
 * GET /api/cv/[profileId]: CV interno de un perfil.
 *
 * Reune el historial de proyectos en los que el perfil ha participado (alimentado
 * por project_members: titulo, rol, contribucion, fecha de ingreso) mas su
 * reputacion AGREGADA con k-anonimato (profile_reputation, >= 3 reviews).
 *
 * Anonimato: nunca se exponen reviews individuales; solo promedios. Debajo del
 * umbral, avg_* viene en null y solo se ve el conteo.
 *
 * Admin client + verificacion de sesion en el handler. Visible para cualquier
 * miembro autenticado de la organizacion (es un CV interno, por diseno).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: { profileId: string } }
) {
  if (!isUuid(params.profileId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  // Perfil base
  type ProfileRow = { id: string; display_name: string | null; avatar_url: string | null; email: string | null; org_role: string }
  const { data: profile } = await admin
    .from('profiles')
    .select('id, display_name, avatar_url, email, org_role')
    .eq('id', params.profileId)
    .maybeSingle() as { data: ProfileRow | null }
  if (!profile) return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 404 })

  // Historial de proyectos (CV): membresias del perfil enriquecidas con el proyecto.
  type MembershipRow = {
    role: string
    title: string | null
    contribution: string | null
    joined_at: string
    project: {
      id: string; name: string; is_archived: boolean; status: string | null
      lead_id: string | null; workspace_id: string
    } | null
  }
  const { data: memberships } = await admin
    .from('project_members')
    .select('role, title, contribution, joined_at, project:projects!project_members_project_id_fkey(id, name, is_archived, status, lead_id, workspace_id)')
    .eq('profile_id', params.profileId)
    .order('joined_at', { ascending: false }) as { data: MembershipRow[] | null }

  const projects = (memberships ?? [])
    .filter(m => m.project)
    .map(m => ({
      id:           m.project!.id,
      name:         m.project!.name,
      status:       m.project!.status,
      is_archived:  m.project!.is_archived,
      role:         m.role,
      title:        m.title,
      contribution: m.contribution,
      joined_at:    m.joined_at,
      is_lead:      m.project!.lead_id === params.profileId,
    }))

  // Reputacion agregada (k-anonimato dentro de la funcion). RPC devuelve 1 fila.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: repRows } = await (admin as any)
    .rpc('profile_reputation', { p_profile_id: params.profileId }) as {
      data: {
        review_count: number
        avg_collaboration: number | null
        avg_quality: number | null
        avg_reliability: number | null
        avg_communication: number | null
        avg_overall: number | null
      }[] | null
    }
  const reputation = repRows?.[0] ?? {
    review_count: 0,
    avg_collaboration: null, avg_quality: null, avg_reliability: null,
    avg_communication: null, avg_overall: null,
  }

  return NextResponse.json({
    profile: {
      id:           profile.id,
      display_name: profile.display_name,
      avatar_url:   profile.avatar_url,
      email:        profile.email,
    },
    stats: {
      total_projects: projects.length,
      leading:        projects.filter(p => p.is_lead).length,
      active:         projects.filter(p => !p.is_archived).length,
    },
    reputation,
    projects,
  })
}
