/**
 * Configuracion -> Herramientas. El marketplace del workspace.
 *
 * Aqui se decide QUE PANTALLAS existen para este equipo. No es un catalogo de
 * adorno: lo que se instala aparece en la barra lateral de todos, y lo que se
 * desinstala desaparece de todos.
 *
 * Tres decisiones que no son de forma:
 *
 *   1. Vive bajo /settings, asi que el layout ya echo al que no es admin antes de
 *      llegar aqui. Aun asi se le pasa `isAdmin` a la vista y los interruptores
 *      se apagan si viene en false: la pantalla no debe asumir quien la gateo, y
 *      el candado que de verdad manda esta en POST /api/workspaces/[id]/tools,
 *      que vuelve a exigir admin (el navegador no autoriza nada).
 *   2. El catalogo se lee de CODIGO (`src/lib/features.ts`), no de la base ni del
 *      disco. Una herramienta es una pantalla que ya existe en el repo; instalar
 *      solo agrega su clave a `workspaces.installed_features`. No hay subida de
 *      paquetes, no hay `require` dinamico, no hay nada que ejecutar.
 *   3. Se muestran tambien las funciones NO instalables, como bloque de solo
 *      lectura ("Incluidas"). Sin eso el marketplace parece decir que el workspace
 *      tiene una sola herramienta, y la pregunta obvia ("¿y donde estan las
 *      tareas?") queda sin respuesta en pantalla.
 */
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { FEATURES, INSTALLABLE_FEATURES, normalizeInstalled } from '@/lib/features'
import { HerramientasManager } from './HerramientasManager'

export default async function HerramientasSettingsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
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

  const incluidas = FEATURES.filter((f) => !f.installable).map((f) => ({
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
