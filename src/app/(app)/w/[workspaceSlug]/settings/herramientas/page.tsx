/**
 * Configuracion -> Herramientas. El marketplace del workspace, entrada de admin.
 *
 * La pantalla vive en `src/components/marketplace/MarketplacePanel.tsx` y la
 * comparte con `/w/{slug}/marketplace`, que es la misma vista abierta a
 * cualquier miembro. Esta ruta se queda porque es donde un admin la busca: al
 * lado de Miembros, Accesos y Equipos, que es donde se toman las decisiones que
 * afectan a todos.
 *
 * Aqui se decide QUE PANTALLAS existen para este equipo. No es un catalogo de
 * adorno: lo que se instala aparece en la barra lateral de todos, y lo que se
 * desinstala desaparece de todos.
 *
 * Dos cosas que no son de forma y por eso se repiten:
 *
 *   1. El gate de admin de esta ruta lo pone el layout de /settings, no la
 *      pagina. Aun asi el panel recibe `isAdmin` y apaga los interruptores si
 *      viene en false: la pantalla no debe asumir quien la gateo. El candado que
 *      de verdad manda esta en POST /api/workspaces/[id]/tools, que vuelve a
 *      exigir admin (el navegador no autoriza nada).
 *   2. El catalogo se lee de CODIGO (`src/lib/features.ts`), no de la base ni del
 *      disco. Una herramienta es una pantalla que ya existe en el repo; instalar
 *      solo agrega su clave a `workspaces.installed_features`. No hay subida de
 *      paquetes, no hay `require` dinamico, no hay nada que ejecutar.
 */
import { MarketplacePanel } from '@/components/marketplace/MarketplacePanel'

export default function HerramientasSettingsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  return <MarketplacePanel workspaceSlug={params.workspaceSlug} />
}
