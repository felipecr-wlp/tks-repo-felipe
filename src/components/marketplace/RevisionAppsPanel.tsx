/**
 * Bandeja de revision del catalogo de herramientas externas.
 *
 * Solo la ve el mando de la ORGANIZACION (`profiles.org_role` owner o admin), no
 * un admin de workspace. La distincion es la misma que hace la ruta: un admin de
 * workspace decide que se instala en SU workspace; decidir que entra al catalogo
 * de todos es otro nivel. Para quien no es mando, este bloque no existe.
 *
 * Ese `return null` es cortesia visual, igual que en el resto del marketplace: el
 * candado que manda esta en PATCH /api/connectors/apps/[appId], que vuelve a leer
 * el `org_role` y responde 403. Que la pantalla no se pinte no autoriza ni
 * desautoriza nada, solo evita ofrecer un boton que iba a fallar.
 *
 * Se lee `org_role` aqui a mano en vez de reusar el helper de workspace-admin a
 * proposito: ese helper mezcla mando de organizacion con mando de workspace en un
 * solo `isAdmin`, y aqui hace falta justo el que NO se mezcla.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/auth'
import { loadReviewQueue } from '@/lib/connectors/catalog'
import { RevisionAppsManager } from './RevisionAppsManager'

export async function RevisionAppsPanel() {
  const user = await getCachedUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: profile } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .maybeSingle()) as { data: { org_role: string | null } | null }

  const orgRole = profile?.org_role ?? 'member'
  if (orgRole !== 'owner' && orgRole !== 'admin') return null

  const apps = await loadReviewQueue(admin)

  return (
    <div className="pt-8">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Revision del catalogo
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Lo que el equipo propone entra aqui antes de existir para nadie mas. Aprobar no la instala en
        ningun lado: la deja disponible para que un admin decida, workspace por workspace, que
        permisos le concede.
      </p>
      <RevisionAppsManager apps={apps} />
    </div>
  )
}
