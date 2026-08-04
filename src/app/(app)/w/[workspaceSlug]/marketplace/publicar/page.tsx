/**
 * Publicar una herramienta: pantalla propia, no un dialogo.
 *
 * Vive fuera de /settings a proposito, igual que el marketplace: publicar es de
 * cualquier miembro, no del admin. Quien construye la herramienta casi nunca es
 * el que administra el workspace, y exigirle ese rol seria pedirle permiso para
 * pedir permiso. Lo que nace aqui nace en BORRADOR y no se lista ni se instala
 * hasta que el mando lo apruebe, asi que la puerta ancha no afloja nada.
 *
 * El contenedor y el scroll se ponen aqui porque esta ruta, como la del
 * marketplace, no tiene un layout que se los ponga.
 */
import { notFound } from 'next/navigation'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { PublicarHerramientaForm } from '@/components/marketplace/PublicarHerramientaForm'

export const metadata = { title: 'Publicar herramienta · WLO' }

export default async function PublicarHerramientaPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  // Ser miembro es el piso. `getWorkspaceAdminContext` devuelve null tanto para
  // el que no tiene sesion como para el que no pertenece: en los dos casos esta
  // pantalla no existe, y decir "no existe" filtra menos que decir "no puedes".
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) notFound()

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PublicarHerramientaForm
        workspaceId={ctx.workspace.id}
        workspaceSlug={params.workspaceSlug}
      />
    </div>
  )
}
