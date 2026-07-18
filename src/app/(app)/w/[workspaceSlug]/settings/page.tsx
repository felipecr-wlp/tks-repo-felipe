/**
 * Configuración → General. Editar nombre y descripcion del workspace.
 */
import { redirect } from 'next/navigation'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { GeneralPanel } from './GeneralPanel'

export default async function GeneralSettingsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  return (
    <GeneralPanel
      workspaceId={ctx.workspace.id}
      workspaceSlug={ctx.workspace.slug}
      initialName={ctx.workspace.name}
      initialDescription={ctx.workspace.description}
    />
  )
}
