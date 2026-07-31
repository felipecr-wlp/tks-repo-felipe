/**
 * Configuracion -> Conectores. El panel de control del ecosistema de complementos.
 *
 * Cuatro pestanas: Complementos (que apps estan instaladas y con que scopes),
 * Keys (tokens por integracion, con scopes acotados), Webhooks (suscripciones a
 * eventos entre apps) y Auditoria (bitacora de llamadas).
 *
 * Solo admin/owner del workspace. El detalle del contrato vive en el documento de
 * arquitectura compartido con Felipe.
 */
import { redirect } from 'next/navigation'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { ConnectorsPanel } from './ConnectorsPanel'

export default async function ConnectorsSettingsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  return (
    <ConnectorsPanel
      workspaceId={ctx.workspace.id}
      workspaceSlug={ctx.workspace.slug}
    />
  )
}
