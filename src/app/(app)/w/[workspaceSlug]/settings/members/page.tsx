/**
 * Configuración → Miembros. Lista los miembros del workspace y permite cambiar rol o quitar.
 */
import { redirect } from 'next/navigation'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { MembersPanel } from './MembersPanel'

export default async function MembersSettingsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  return <MembersPanel workspaceId={ctx.workspace.id} currentUserId={ctx.userId} />
}
