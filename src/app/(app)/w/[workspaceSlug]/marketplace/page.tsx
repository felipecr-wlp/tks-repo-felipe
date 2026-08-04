/**
 * Marketplace del workspace, entrada para TODO el equipo.
 *
 * Es la misma pantalla que Configuracion > Herramientas
 * (`src/components/marketplace/MarketplacePanel.tsx`), servida fuera de
 * /settings. La diferencia no es de permisos, es de puerta: el layout de
 * Configuracion redirige a quien no es admin, asi que mientras el catalogo vivio
 * solo ahi, el resto del equipo no tenia forma de saber que existian
 * herramientas para pedir. Ahora lo ve cualquiera que sea miembro.
 *
 * Lo que se puede HACER no cambio: instalar y desinstalar siguen exigiendo admin
 * del workspace en POST /api/workspaces/[workspaceId]/tools. Al que no es admin
 * los botones le salen apagados con la etiqueta que lo explica. Abrir el
 * catalogo no afloja el candado, y esa distincion (ver vs. poder) es toda la
 * idea de esta ruta.
 *
 * El contenedor y el titulo se pintan aqui porque, a diferencia de la ruta de
 * Configuracion, esta no tiene un layout que se los ponga.
 */
import { MarketplacePanel } from '@/components/marketplace/MarketplacePanel'
import { AppsExternasPanel } from '@/components/marketplace/AppsExternasPanel'
import { RevisionAppsPanel } from '@/components/marketplace/RevisionAppsPanel'

export const metadata = { title: 'Marketplace · WLO' }

export default function MarketplacePage({ params }: { params: { workspaceSlug: string } }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="w-full max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">Marketplace</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Las herramientas que este workspace tiene encendidas, y las que puede agregar.
          </p>
        </div>

        <MarketplacePanel workspaceSlug={params.workspaceSlug} />
        <AppsExternasPanel workspaceSlug={params.workspaceSlug} />
        {/* Se pinta solo para el mando de la organizacion. Para el resto no
            existe: el componente devuelve null. */}
        <RevisionAppsPanel />
      </div>
    </div>
  )
}
