/**
 * Layout del panel de administracion del workspace (Configuración).
 * Gatea a admins del workspace u org owners/admins; los demas se redirigen.
 * Provee la navegacion por pestañas y el contenedor comun.
 */
import { redirect } from 'next/navigation'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { SettingsNav } from './SettingsNav'

export const metadata = { title: 'Configuración · WLO' }

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="w-full max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">Configuración</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Administra {ctx.workspace.name}: datos generales, miembros, equipos, departamentos e invitaciones.
          </p>
        </div>

        <SettingsNav workspaceSlug={params.workspaceSlug} />

        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}
