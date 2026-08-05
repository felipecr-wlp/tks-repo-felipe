/**
 * Puente entre el padron del espacio y el sustituidor de nombres.
 *
 * Vive aparte de `seudonimos.ts` a proposito: aquel es puro (entra un arreglo
 * de nombres, sale un objeto) y por eso se puede probar a fondo sin base de
 * datos. Este toca Supabase. Mezclarlos obligaria a montar la base para probar
 * la unica parte que de verdad conviene probar a conciencia.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { MODELO_RECIBE_DATOS_PERSONALES } from './client'
import { crearSeudonimos, type Seudonimos } from './seudonimos'

/**
 * Arma el sustituidor con los nombres de los miembros del espacio.
 *
 * Si el proveedor activo SI puede ver nombres (hoy Gemini), devuelve la version
 * inerte sin consultar nada: ni una query de mas por una proteccion que en ese
 * caso no hace falta.
 *
 * Si la consulta falla, se devuelve un sustituidor VACIO, que tambien es
 * inerte. Conviene tenerlo claro: ante un fallo de base esto NO bloquea la IA,
 * la deja pasar sin sustituir. Es la decision deliberada de no tumbar una
 * funcion del producto por no poder leer el padron, y es justo el motivo por el
 * que la cabecera de `seudonimos.ts` insiste en que esta capa quita a las
 * personas del equipo del material que sale, no convierte el reporte en anonimo.
 */
export async function seudonimosDelWorkspace(
  admin: SupabaseClient,
  workspaceId: string
): Promise<Seudonimos> {
  if (MODELO_RECIBE_DATOS_PERSONALES) return crearSeudonimos([], false)

  const { data, error } = await admin
    .from('workspace_members')
    .select('profile:profiles ( display_name )')
    .eq('workspace_id', workspaceId)

  if (error || !data) {
    console.error('[seudonimos] no se pudo leer el padron del espacio:', error?.message)
    return crearSeudonimos([], false)
  }

  return crearSeudonimos(nombresDe(data))
}

/**
 * Igual, pero para KERN, que no conversa sobre un espacio sino sobre TODO lo
 * del usuario. El padron es la union de los espacios a los que pertenece: un
 * padron mas corto dejaria salir el nombre de un compañero de otro espacio.
 */
export async function seudonimosDelUsuario(
  admin: SupabaseClient,
  userId: string
): Promise<Seudonimos> {
  if (MODELO_RECIBE_DATOS_PERSONALES) return crearSeudonimos([], false)

  const { data: propios, error: errorPropios } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('profile_id', userId)

  if (errorPropios || !propios?.length) {
    if (errorPropios) {
      console.error('[seudonimos] no se pudieron leer los espacios del usuario:', errorPropios.message)
    }
    return crearSeudonimos([], false)
  }

  const { data, error } = await admin
    .from('workspace_members')
    .select('profile:profiles ( display_name )')
    .in('workspace_id', propios.map(w => (w as { workspace_id: string }).workspace_id))

  if (error || !data) {
    console.error('[seudonimos] no se pudo leer el padron del usuario:', error?.message)
    return crearSeudonimos([], false)
  }

  return crearSeudonimos(nombresDe(data))
}

/** Saca los display_name del embed, venga como objeto o como arreglo de uno. */
function nombresDe(filas: unknown[]): string[] {
  return filas
    .map(fila => {
      const perfil = (fila as { profile?: unknown }).profile
      const uno = Array.isArray(perfil) ? perfil[0] : perfil
      return (uno as { display_name?: string } | null)?.display_name ?? ''
    })
    .filter(Boolean)
}
