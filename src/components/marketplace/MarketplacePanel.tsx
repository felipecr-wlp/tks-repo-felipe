/**
 * El marketplace del workspace: la carga de datos, una sola vez.
 *
 * Lo pintan DOS rutas y a proposito son la misma pantalla:
 *
 *   /w/{slug}/marketplace            abierto a cualquier miembro
 *   /w/{slug}/settings/herramientas  dentro de Configuracion, solo admins
 *
 * La segunda existia primero y sigue existiendo porque un admin busca esto en
 * Configuracion; la primera se agrego porque ahi NO lo encuentra nadie mas. El
 * layout de Configuracion echa al que no es admin antes de llegar a la pagina,
 * asi que mientras el marketplace vivio solo ahi, el equipo no tenia como
 * enterarse de que existian herramientas para pedir. Un catalogo que solo ve
 * quien ya sabe que hay adentro no es un catalogo.
 *
 * Que este componente sea uno solo no es prolijidad: dos copias se
 * desincronizan, y el dia que se arregle un caso raro en una, la otra sigue
 * mintiendo. Cual de las dos vio la persona pasa a ser parte del bug.
 *
 * ── El permiso no lo decide esta pantalla ──────────────────────────────────
 * `isAdmin` viaja hasta los botones y los apaga si viene en false, pero eso es
 * cortesia visual, no seguridad: el candado que manda esta en
 * POST /api/workspaces/[workspaceId]/tools, que vuelve a exigir admin del
 * workspace. Abrir esta ruta a todo miembro NO afloja nada, porque el navegador
 * nunca autorizo nada. Lo que cambia es que ahora se puede VER el catalogo.
 *
 * Ser miembro sigue siendo el piso: `getWorkspaceAdminContext` devuelve null si
 * no hay sesion o si la persona no pertenece al workspace.
 */
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { FEATURES, INSTALLABLE_FEATURES, normalizeInstalled } from '@/lib/features'
import { HerramientasManager } from './HerramientasManager'

export async function MarketplacePanel({ workspaceSlug }: { workspaceSlug: string }) {
  const ctx = await getWorkspaceAdminContext(workspaceSlug)
  // null = no hay sesion o no es miembro de este workspace. Ser miembro es el
  // piso; el rol solo decide si los interruptores estan vivos.
  if (!ctx) redirect('/auth/login')

  const admin = createAdminClient()
  const { data: ws } = (await admin
    .from('workspaces')
    .select('installed_features')
    .eq('id', ctx.workspace.id)
    .maybeSingle()) as { data: { installed_features: string[] | null } | null }

  const installed = normalizeInstalled(ws?.installed_features)

  // Lo que viene del catalogo se serializa aqui (el cliente no debe importar
  // `features.ts` completo solo para pintar tarjetas).
  const instalables = INSTALLABLE_FEATURES.map((f) => ({
    key: f.key,
    labelKey: f.labelKey,
    description: f.description,
  }))

  // Las de fabrica se muestran como bloque de solo lectura. Sin eso el
  // marketplace parece decir que el workspace tiene tres herramientas, y la
  // pregunta obvia ("¿y donde estan las tareas?") queda sin respuesta en
  // pantalla. Se excluye `marketplace`: listarse a si mismo no le dice nada a
  // nadie, y quien esta leyendo esto ya lo encontro.
  const incluidas = FEATURES.filter((f) => !f.installable && f.key !== 'marketplace').map((f) => ({
    key: f.key,
    labelKey: f.labelKey,
    description: f.description,
  }))

  return (
    <HerramientasManager
      workspaceId={ctx.workspace.id}
      isAdmin={ctx.isAdmin}
      instalables={instalables}
      incluidas={incluidas}
      installed={installed}
    />
  )
}
