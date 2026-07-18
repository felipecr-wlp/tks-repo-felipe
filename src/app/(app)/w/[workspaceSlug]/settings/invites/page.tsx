/**
 * Configuración → Invitaciones del workspace.
 * El gate de admin lo aplica el layout de settings; aqui solo resolvemos el workspace.
 */
import { redirect, notFound } from 'next/navigation'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { InvitesPanel } from './InvitesPanel'

export default async function InvitesSettingsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)
  if (!ctx.workspace) notFound()

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Genera códigos para que otros se unan a {ctx.workspace.name}.
      </p>
      <InvitesPanel workspaceId={ctx.workspace.id} workspaceSlug={ctx.workspace.slug} />
    </div>
  )
}
