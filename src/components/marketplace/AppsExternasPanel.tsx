/**
 * Bloque de herramientas EXTERNAS dentro del marketplace.
 *
 * Va debajo del catalogo de funciones de fabrica, en la misma pantalla, a
 * proposito: para quien las usa las dos cosas son "herramientas que este
 * workspace tiene". La diferencia (una la trae WLO, la otra la publico alguien
 * del equipo en su propio deploy) importa para el permiso, no para donde buscarla.
 *
 * Ser miembro es el piso para VER. Instalar sigue exigiendo admin del workspace,
 * y eso lo vuelve a exigir la ruta: aqui `isAdmin` solo apaga botones.
 */
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { loadCatalog } from '@/lib/connectors/catalog'
import { AppsExternasManager } from './AppsExternasManager'

export async function AppsExternasPanel({ workspaceSlug }: { workspaceSlug: string }) {
  const ctx = await getWorkspaceAdminContext(workspaceSlug)
  if (!ctx) return null

  const admin = createAdminClient()
  const apps = await loadCatalog(admin, ctx.workspace.id)

  return (
    <div className="pt-8">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Herramientas del equipo
        </h2>
        {/* Proponer es de CUALQUIER miembro, no solo del admin: lo que nace nace en
            borrador y no se instala solo. Pedirle rol de admin a quien construye la
            herramienta seria pedirle permiso para pedir permiso.

            Antes esto abria un dialogo. Ahora lleva a una pantalla propia: son
            ocho campos, un catalogo de permisos y una comprobacion de la URL, y
            nada de eso cabe en un recuadro sin scroll dentro de scroll. */}
        <Link
          href={`/w/${workspaceSlug}/marketplace/publicar`}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition hover:bg-muted"
        >
          <Plus size={13} /> Publicar herramienta
        </Link>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Cada una vive en su propio deploy y su propio repositorio, en el lenguaje que sea. WLO no
        compila el codigo de nadie: guarda a donde apunta y que permisos pidio sobre este workspace.
      </p>
      <AppsExternasManager
        workspaceId={ctx.workspace.id}
        workspaceSlug={workspaceSlug}
        isAdmin={ctx.isAdmin}
        apps={apps}
      />
    </div>
  )
}
