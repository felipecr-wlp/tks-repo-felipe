/**
 * Academia WLP: biblioteca de cursos. El usuario ve los cursos a los que tiene
 * acceso (concedido por un admin), su progreso y el estado de sus solicitudes.
 * Para los cursos sin acceso puede "Solicitar acceso" (flujo pedir -> aprobar).
 *
 * El server valida sesion + membresia (anti-IDOR por slug) y calcula el estado
 * por curso con getUserAcademy. El detalle interactivo lo maneja el cliente.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserAcademy, isOrgAdmin } from '@/lib/academy/data'
import { AcademyLibrary } from './AcademyLibrary'

interface PageProps {
  params: { workspaceSlug: string }
}

export default async function AcademiaPage({ params }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  type WsRow = { workspaces: { id: string; name: string } | null }
  const { data: row } = (await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle()) as { data: WsRow | null }

  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  const [states, adminFlag] = await Promise.all([getUserAcademy(user.id), isOrgAdmin(user.id)])

  return (
    <AcademyLibrary
      workspaceSlug={params.workspaceSlug}
      workspaceId={workspace.id}
      states={states}
      isAdmin={adminFlag}
    />
  )
}
